'use strict';

/**
 * @module s3
 * @description AWS S3 client wrapper service handling S3 object uploads, pre-signed URL generation,
 * batch object deletion, and archive object listing.
 */

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

/**
 * Initializes and returns the shared AWS S3 SDK client instance.
 * Automatically resolves credentials from environment variables or IAM Instance Profile.
 * 
 * @returns {S3Client} Active AWS S3 client
 */
function getClient() {
  if (s3Client) return s3Client;
  const clientConfig = {
    region: config.AWS_REGION || 'ap-south-1',
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  s3Client = new S3Client(clientConfig);
  return s3Client;
}

/**
 * Checks if target AWS S3 bucket is configured in environment settings.
 * 
 * @returns {boolean} True if S3_BUCKET is defined
 */
function isS3Configured() {
  return Boolean(config.S3_BUCKET);
}

/**
 * Uploads data object to AWS S3 bucket.
 * 
 * @param {string} key - Target S3 object key
 * @param {Buffer|ReadableStream|string} body - Object payload
 * @param {string} [contentType='application/gzip'] - HTTP Content-Type header
 * @returns {Promise<Object>} AWS S3 PutObject response
 */
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

/**
 * Generates a pre-signed temporary download URL for an S3 object.
 * 
 * @param {string} key - S3 object key
 * @param {number} [expiresIn=3600] - Presigned URL expiration time in seconds
 * @returns {Promise<string>} Pre-signed S3 download URL
 */
async function getPresignedDownloadUrl(key, expiresIn = 3600) {
  if (!isS3Configured()) throw new Error('S3_BUCKET is not configured in environment');
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return await getSignedUrl(client, command, { expiresIn });
}

/**
 * Deletes a single object from S3 bucket.
 * 
 * @param {string} key - S3 object key
 * @returns {Promise<Object|void>} S3 DeleteObject response
 */
async function deleteObject(key) {
  if (!isS3Configured()) return;
  const client = getClient();
  const command = new DeleteObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return await client.send(command);
}

/**
 * Deletes multiple objects in batch from S3 bucket.
 * 
 * @param {Array<string>} keys - List of S3 object keys to delete
 * @returns {Promise<Object|void>} S3 DeleteObjects response
 */
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

/**
 * Lists S3 object archive contents matching a given key prefix.
 * 
 * @param {string} prefix - Key prefix filter
 * @returns {Promise<Array<{key: string, size: number, lastModified: Date}>>} List of matching archive objects
 */
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
  getClient,
  isS3Configured,
  uploadArchive,
  getPresignedDownloadUrl,
  deleteObject,
  deleteObjects,
  listArchives,
};
