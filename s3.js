'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('./config');

let s3Client = null;

function getClient() {
  if (s3Client) return s3Client;
  const clientConfig = {
    region: config.AWS_REGION || 'ap-south-1',
  };

  // If explicit credentials are provided in env, use them; otherwise SDK automatically
  // resolves credentials from EC2 IAM roles or AWS environment metadata.
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  s3Client = new S3Client(clientConfig);
  return s3Client;
}

function isS3Configured() {
  return Boolean(config.S3_BUCKET);
}

async function uploadArchive(key, body, contentType = 'application/gzip') {
  if (!isS3Configured()) throw new Error('S3_BUCKET is not configured in environment');
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  return await client.send(command);
}

async function getPresignedDownloadUrl(key, expiresIn = 3600) {
  if (!isS3Configured()) throw new Error('S3_BUCKET is not configured in environment');
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return await getSignedUrl(client, command, { expiresIn });
}

async function deleteObject(key) {
  if (!isS3Configured()) return;
  const client = getClient();
  const command = new DeleteObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return await client.send(command);
}

async function deleteObjects(keys) {
  if (!isS3Configured() || !keys || keys.length === 0) return;
  const client = getClient();
  const command = new DeleteObjectsCommand({
    Bucket: config.S3_BUCKET,
    Delete: {
      Objects: keys.map((k) => ({ Key: k })),
      Quiet: true,
    },
  });
  return await client.send(command);
}

async function listArchives(prefix) {
  if (!isS3Configured()) return [];
  const client = getClient();
  const command = new ListObjectsV2Command({
    Bucket: config.S3_BUCKET,
    Prefix: prefix,
  });
  const res = await client.send(command);
  return (res.Contents || []).map((item) => ({
    key: item.Key,
    size: item.Size,
    lastModified: item.LastModified,
  }));
}

module.exports = {
  isS3Configured,
  uploadArchive,
  getPresignedDownloadUrl,
  deleteObject,
  deleteObjects,
  listArchives,
};
