import assert from 'assert';
import crypto from 'crypto';
import { S3 } from 'aws-sdk';

import getConfig from '../support/config';

const random = Math.round(Math.random() * 100).toString();
const bucket = `ftest-mybucket-${random}`;

// Create a buffer to put as a multipart upload part
// and get its ETag
const md5HashFirstPart = crypto.createHash('md5');
const firstBufferBody =
    new Buffer(5242880).fill(0);
const md5HashSecondPart = crypto.createHash('md5');
const secondBufferBody =
    new Buffer(5242880).fill(1);
md5HashFirstPart.update(firstBufferBody);
md5HashSecondPart.update(secondBufferBody);
const calculatedFirstPartHash = md5HashFirstPart.digest('hex');
const calculatedSecondPartHash = md5HashSecondPart.digest('hex');
const combinedETag = '0ea4f0f688a0be07ae1d92eb298d5218-2';

// Store uploadId's in memory so can do multiple tests with
// same uploadId
const multipartUploadData = {};

describe('aws-node-sdk test suite as registered user', function testSuite() {
    this.timeout(60000);
    let s3;

    before(function setup() {
        const config = getConfig('default', { signatureVersion: 'v4' });

        s3 = new S3(config);
    });

    it('should do bucket listing', function bucketListing(done) {
        s3.listBuckets((err, data) => {
            if (err) {
                return done(new Error(`error listing buckets: ${err}`));
            }

            assert(data.Buckets, 'No buckets Info sent back');
            assert(data.Owner, 'No owner Info sent back');
            assert(data.Owner.ID, 'Owner ID not sent back');
            assert(data.Owner.DisplayName, 'DisplayName not sent back');
            const owner = Object.keys(data.Owner);
            assert.strictEqual(owner.length, 2, 'Too much fields in owner');
            done();
        });
    });

    it('should create a bucket', function createbucket(done) {
        s3.createBucket({ Bucket: bucket }, (err) => {
            if (err) {
                return done(new Error(`error creating bucket: ${err}`));
            }
            done();
        });
    });

    it('should create a multipart upload', function createMPU(done) {
        s3.createMultipartUpload({ Bucket: bucket, Key: 'toAbort' },
            (err, data) => {
                if (err) {
                    return done(new Error(
                        `error initiating multipart upload: ${err}`));
                }
                assert.strictEqual(data.Bucket, bucket);
                assert.strictEqual(data.Key, 'toAbort');
                assert.ok(data.UploadId);
                multipartUploadData.firstUploadId = data.UploadId;
                done();
            });
    });

    it('should upload a part of a multipart upload to be aborted',
        function uploadpart(done) {
            const params = {
                Bucket: bucket,
                Key: 'toAbort',
                PartNumber: 1,
                UploadId: multipartUploadData.firstUploadId,
                Body: firstBufferBody,
            };
            s3.uploadPart(params, (err, data) => {
                if (err) {
                    return done(new Error(`error uploading a part: ${err}`));
                }
                assert.strictEqual(data.ETag, `"${calculatedFirstPartHash}"`);
                done();
            });
        });

    it('should abort a multipart upload', function abortMPU(done) {
        const params = {
            Bucket: bucket,
            Key: 'toAbort',
            UploadId: multipartUploadData.firstUploadId,
        };
        s3.abortMultipartUpload(params, (err, data) => {
            if (err) {
                return done(new Error(
                    `error aborting multipart upload: ${err}`));
            }
            assert.ok(data);
            done();
        });
    });

    it('should upload a part of a multipart upload', function createMPU(done) {
        s3.createMultipartUpload({ Bucket: bucket, Key: 'toComplete' },
            (err, data) => {
                if (err) {
                    return done(new Error(
                        `error initiating multipart upload: ${err}`));
                }
                const uploadId = data.UploadId;
                multipartUploadData.secondUploadId = data.UploadId;
                const params = {
                    Bucket: bucket,
                    Key: 'toComplete',
                    PartNumber: 1,
                    UploadId: uploadId,
                    Body: firstBufferBody,
                };
                s3.uploadPart(params, (err, data) => {
                    if (err) {
                        return done(
                            new Error('error uploading a part: ${err}'));
                    }
                    assert.strictEqual(data.ETag,
                        `"${calculatedFirstPartHash}"`);
                    done();
                });
            });
    });

    it('should upload a second part of a multipart upload',
        function createMPU(done) {
            const params = {
                Bucket: bucket,
                Key: 'toComplete',
                PartNumber: 2,
                UploadId: multipartUploadData.secondUploadId,
                Body: secondBufferBody,
            };
            s3.uploadPart(params, (err, data) => {
                if (err) {
                    return done(new Error(`error uploading a part: ${err}`));
                }
                assert.strictEqual(data.ETag, `"${calculatedSecondPartHash}"`);
                done();
            });
        });

    it('should list the parts of a multipart upload', function listparts(done) {
        const params = {
            Bucket: bucket,
            Key: 'toComplete',
            UploadId: multipartUploadData.secondUploadId,
        };
        s3.listParts(params, (err, data) => {
            if (err) {
                return done(new Error(`error listing parts: ${err}`));
            }
            assert.strictEqual(data.Bucket, bucket);
            assert.strictEqual(data.Key, 'toComplete');
            assert.strictEqual(data.UploadId, multipartUploadData
                .secondUploadId);
            assert.strictEqual(data.IsTruncated, false);
            assert.strictEqual(data.Parts[0].PartNumber, 1);
            assert.strictEqual(data.Parts[0].ETag, calculatedFirstPartHash);
            assert.strictEqual(data.Parts[0].Size, 5242880);
            assert.strictEqual(data.Parts[1].PartNumber, 2);
            assert.strictEqual(data.Parts[1].ETag, calculatedSecondPartHash);
            assert.strictEqual(data.Parts[1].Size, 5242880);
            // Must disable for now when running with Vault
            // since will need to pull actual ARN and canonicalId
            // assert.strictEqual(data.Initiator.ID, accessKey1ARN);
            // Note that for in memory implementation, "accessKey1"
            // is both the access key and the canonicalId so this
            // call works.  For real implementation with vault,
            // will need the canonicalId.
            // assert.strictEqual(data.Owner.ID, config.accessKeyId);
            assert.strictEqual(data.StorageClass, 'STANDARD');
        });
        done();
    });

    it('should list ongoing multipart uploads', (done) => {
        const params = {
            Bucket: bucket,
        };
        s3.listMultipartUploads(params, (err, data) => {
            if (err) {
                return done(new Error(`error in listMultipartUploads: ${err}`));
            }
            assert.strictEqual(data.Uploads.length, 1);
            assert.strictEqual(data.Uploads[0].UploadId,
                multipartUploadData.secondUploadId);
            done();
        });
    });

    it('should list ongoing multipart uploads with params', (done) => {
        const params = {
            Bucket: bucket,
            Prefix: 'to',
            MaxUploads: 2,
        };
        s3.listMultipartUploads(params, (err, data) => {
            if (err) {
                return done(new Error(`error in listMultipartUploads: ${err}`));
            }
            assert.strictEqual(data.Uploads.length, 1);
            assert.strictEqual(data.Uploads[0].UploadId,
                multipartUploadData.secondUploadId);
            done();
        });
    });

    it('should return an error if do not provide correct ' +
        'xml when completing a multipart upload', function completempu(done) {
        const params = {
            Bucket: bucket,
            Key: 'toComplete',
            UploadId: multipartUploadData.secondUploadId,
        };
        s3.completeMultipartUpload(params, (err) => {
            assert.strictEqual(err.code, 'MalformedXML');
            done();
        });
    });

    it('should complete a multipart upload', function completempu(done) {
        const params = {
            Bucket: bucket,
            Key: 'toComplete',
            UploadId: multipartUploadData.secondUploadId,
            MultipartUpload: {
                Parts: [
                    {
                        ETag: `"${calculatedFirstPartHash}"`,
                        PartNumber: 1,
                    },
                    {
                        ETag: `"${calculatedSecondPartHash}"`,
                        PartNumber: 2,
                    },
                ],
            },
        };
        s3.completeMultipartUpload(params, (err, data) => {
            if (err) {
                return done(new Error(`error completing mpu: ${err}`));
            }
            assert.strictEqual(data.Bucket, bucket);
            assert.strictEqual(data.Key, 'toComplete');
            assert.strictEqual(data.ETag, combinedETag);
            done();
        });
    });

    it('should get an object put by multipart upload', done => {
        const params = {
            Bucket: bucket,
            Key: 'toComplete',
        };
        s3.getObject(params, (err, data) => {
            if (err) {
                return done(new Error(
                    `error getting object put by mpu: ${err}`));
            }
            assert.strictEqual(data.ETag,
                `"${combinedETag}"`);
            const uploadedObj = Buffer.concat([firstBufferBody,
                secondBufferBody]);
            assert.deepStrictEqual(data.Body, uploadedObj);
            return done();
        });
    });

    const mpuRangeGetTests = [
        { it: 'should get a range from the first part of an object ' +
            'put by multipart upload',
            range: 'bytes=0-9',
            contentLength: '10',
            contentRange: 'bytes 0-9/10485760',
            // Uploaded object is 5MB of 0 in the first part and
            // 5 MB of 1 in the second part so a range from the
            // first part should just contain 0
            expectedBuff: new Buffer(10).fill(0),
        },
        { it: 'should get a range from the second part of an object ' +
            'put by multipart upload',
            range: 'bytes=5242881-5242890',
            contentLength: '10',
            contentRange: 'bytes 5242881-5242890/10485760',
            // A range from the second part should just contain 1
            expectedBuff: new Buffer(10).fill(1),
        },
        { it: 'should get a range that spans both parts of an object put ' +
            'by multipart upload',
            range: 'bytes=5242875-5242884',
            contentLength: '10',
            contentRange: 'bytes 5242875-5242884/10485760',
            // Range that spans the two parts should contain 5 bytes
            // of 0 and 5 bytes of 1
            expectedBuff: new Buffer(10).fill(0, 0, 5).fill(1, 5, 10),
        },
        { it: 'should get a range from the second part of an object put by ' +
            'multipart upload and include the end even if the range ' +
            'requested goes beyond the actual object end',
            // End is actually 10485759 since size is 10485760
            range: 'bytes=10485750-10485790',
            contentLength: '10',
            contentRange: 'bytes 10485750-10485759/10485760',
            // Range from the second part should just contain 1
            expectedBuff: new Buffer(10).fill(1),
        },
    ];

    mpuRangeGetTests.forEach(test => {
        it(test.it, done => {
            const params = {
                Bucket: bucket,
                Key: 'toComplete',
                Range: test.range,
            };
            s3.getObject(params, (err, data) => {
                if (err) {
                    return done(new Error(
                        `error getting object range put by mpu: ${err}`));
                }
                assert.strictEqual(data.ContentLength, test.contentLength);
                assert.strictEqual(data.AcceptRanges, 'bytes');
                assert.strictEqual(data.ContentRange, test.contentRange);
                assert.strictEqual(data.ETag,
                    `"${combinedETag}"`);
                assert.deepStrictEqual(data.Body, test.expectedBuff);
                return done();
            });
        });
    });

    it('should delete object created by multipart upload',
        function deleteObject(done) {
            const params = {
                Bucket: bucket,
                Key: 'toComplete',
            };
            s3.deleteObject(params, (err, data) => {
                if (err) {
                    return done(new Error(`error deleting object: ${err}`));
                }
                assert.ok(data);
                done();
            });
        });

    it('should put an object regularly (non-MPU)', done => {
        const params = {
            Bucket: bucket,
            Key: 'normalput',
            Body: new Buffer(200).fill(0, 0, 50).fill(1, 50),
        };
        s3.putObject(params, (err, data) => {
            if (err) {
                return done(new Error(
                    `error putting object regularly: ${err}`));
            }
            assert.ok(data);
            return done();
        });
    });

    const regularObjectRangeGetTests = [
        { it: 'should get a range for an object put without MPU',
            range: 'bytes=10-99',
            contentLength: '90',
            contentRange: 'bytes 10-99/200',
            // Buffer.fill(value, offset, end)
            expectedBuff: new Buffer(90).fill(0, 0, 40).fill(1, 40),
        },
        { it: 'should get a range for an object using only an end ' +
            'offset in the request',
            range: 'bytes=-10',
            contentLength: '10',
            contentRange: 'bytes 190-199/200',
            expectedBuff: new Buffer(10).fill(1),
        },
        { it: 'should get a range for an object using only a start offset ' +
            'in the request',
            range: 'bytes=190-',
            contentLength: '10',
            contentRange: 'bytes 190-199/200',
            expectedBuff: new Buffer(10).fill(1),
        },
        { it: 'should get full object if range header is invalid',
            range: 'bytes=-',
            contentLength: '200',
            // Since range header is invalid full object should be returned
            // and there should be no Content-Range header
            contentRange: undefined,
            expectedBuff: new Buffer(200).fill(0, 0, 50).fill(1, 50),
        },
    ];

    regularObjectRangeGetTests.forEach(test => {
        it(test.it, done => {
            const params = {
                Bucket: bucket,
                Key: 'normalput',
                Range: test.range,
            };
            s3.getObject(params, (err, data) => {
                if (err) {
                    return done(new Error(
                        `error getting object range: ${err}`));
                }
                assert.strictEqual(data.ContentLength, test.contentLength);
                assert.strictEqual(data.ContentRange, test.contentRange);
                assert.deepStrictEqual(data.Body, test.expectedBuff);
                return done();
            });
        });
    });

    it('should delete an object put without MPU',
        function deleteObject(done) {
            const params = {
                Bucket: bucket,
                Key: 'normalput',
            };
            s3.deleteObject(params, (err, data) => {
                if (err) {
                    return done(new Error(`error deleting object: ${err}`));
                }
                assert.ok(data);
                done();
            });
        });

    it('should delete a bucket', function deletebucket(done) {
        s3.deleteBucket({ Bucket: bucket }, (err) => {
            if (err) {
                return done(new Error(`error deleting bucket: ${err}`));
            }
            done();
        });
    });
});
