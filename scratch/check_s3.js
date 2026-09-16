'use strict';
const { S3Client, ListBucketsCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({ region: 'ap-south-1' });

async function main() {
  try {
    const { Buckets } = await client.send(new ListBucketsCommand({}));
    console.log('Buckets:', Buckets);
  } catch (e) {
    console.error('List error:', e.message);
  }
}

main();
