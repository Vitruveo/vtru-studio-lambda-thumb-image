/* eslint-disable no-await-in-loop */
const { parse: parseFileName, join } = require('path');
const s3client = require('@aws-sdk/client-s3');
const fs = require('fs/promises');
const sharp = require('sharp');
const path = require('path');

const resizeImage = async (inputFile, outputFile) => {
    await sharp(inputFile).jpeg({ quality: 1 }).toFile(outputFile);
};

const downloadFromS3 = async ({ file, bucket, region }) => {
    console.log(
        `[DownloadFromS3] Starting download from S3. File: ${file}, Bucket: ${bucket}, Region: ${region}`
    );
    const s3 = new s3client.S3Client({ region });
    const data = await s3.send(
        new s3client.GetObjectCommand({
            Bucket: bucket,
            Key: file,
        })
    );

    const endFileName = join('/', 'tmp', file);
    const parsedFileName = parseFileName(endFileName);
    await fs.mkdir(parsedFileName.dir, { recursive: true });
    await fs.writeFile(join('/', 'tmp', file), data.Body);

    console.log(
        `[DownloadFromS3] Download from S3 completed. File: ${file}, Bucket: ${bucket}, Region: ${region}`
    );

    return data.Metadata;
};

const uploadToS3 = async ({ file, key, bucket, region }) => {
    console.log(
        `[UploadToS3] Starting upload to S3. File: ${file}, Key: ${key}, Bucket: ${bucket}, Region: ${region}`
    );
    const s3 = new s3client.S3Client({ region });
    const body = await fs.readFile(join('/', 'tmp', file));
    await s3.send(
        new s3client.PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
        })
    );
    console.log(
        `[UploadToS3] Upload to S3 completed. File: ${file}, Key: ${key}, Bucket: ${bucket}, Region: ${region}`
    );
};

const resizeOriginalImage = async (
    { inputFile, bucket, region, filename, metadata },
    quality = 99
) => {
    let stats = await fs.stat(inputFile);
    let currentQuality = quality;
    let changeFormat = '';
    let deleted = false;
    const tempFile = `${inputFile}.tmp`;

    const originalFormat = path.extname(inputFile).slice(1);
    const maxSize = Number(metadata?.maxsize) * 1000000;

    console.log('stats:', stats);
    console.log('metadata maxSize:', metadata, maxSize);
    console.log('inputFile:', inputFile, 'filename:', filename);

    while (stats.size > maxSize) {
        console.log(
            'size',
            stats.size,
            'quality:',
            currentQuality,
            'originalFormat:',
            originalFormat
        );
        if (originalFormat === 'png') {
            if (!deleted) {
                const s3 = new s3client.S3Client({ region });
                await s3.send(
                    new s3client.DeleteObjectCommand({
                        Bucket: bucket,
                        Key: filename,
                    })
                );
                deleted = true;
            }
            await sharp(inputFile)
                .jpeg({
                    quality: currentQuality,
                    progressive: true,
                })
                .toFile(tempFile);

            changeFormat = 'jpeg';
        } else {
            await sharp(inputFile)
                .toFormat(originalFormat, {
                    quality: currentQuality,
                    progressive: true,
                })
                .toFile(tempFile);
        }

        stats = await fs.stat(tempFile);

        if (stats.size > maxSize) {
            currentQuality -= 1;
            if (currentQuality === 0) {
                throw new Error('Unable to reduce file size under 10MB');
            }
        } else {
            const parsedFileName = parseFileName(filename);

            const newFileName = changeFormat?.length
                ? `${parsedFileName.name}.${changeFormat}`
                : filename;

            const pathFileName = changeFormat?.length
                ? join('/', 'tmp', `${parsedFileName.name}.${changeFormat}`)
                : join('/', 'tmp', filename);

            console.log('newFileName:', newFileName);
            console.log('pathFileName:', pathFileName);

            await fs.rename(tempFile, pathFileName);

            const endFileName = join(
                parsedFileName.dir,
                `${parsedFileName.name}.${changeFormat?.length ? changeFormat : originalFormat}`
            );

            await uploadToS3({
                file: newFileName,
                key: endFileName,
                bucket,
                region,
            });
        }
    }
};

const generateThumb = async ({ filename, bucket, region }) => {
    console.log(
        `[GenerateThumb] Starting thumbnail generation. Filename: ${filename}, Bucket: ${bucket}, Region: ${region}`
    );

    const metadata = await downloadFromS3({
        file: filename,
        bucket,
        region,
    });

    const parsedFileName = parseFileName(filename);
    const thumbFilename = `${parsedFileName.name}_thumb.jpg`;

    await resizeImage(
        join('/', 'tmp', filename),
        join('/', 'tmp', thumbFilename)
    );

    const endFileName = join(parsedFileName.dir, thumbFilename);
    await uploadToS3({
        file: thumbFilename,
        key: endFileName,
        bucket,
        region,
    });

    const originalFile = join('/', 'tmp', filename);

    if (metadata?.maxsize)
        await resizeOriginalImage({
            inputFile: originalFile,
            bucket,
            region,
            filename,
            metadata,
        });

    console.log(
        `[GenerateThumb] Thumbnail generation completed. Filename: ${filename}, Bucket: ${bucket}, Region: ${region}`
    );
};

module.exports.postprocess = async (event) => {
    await Promise.all(
        event.Records.map((record) =>
            generateThumb({
                filename: record.s3.object.key,
                bucket: record.s3.bucket.name,
                region: record.awsRegion,
            })
        )
    );
};

const deleteThumb = async ({ filename, bucket, region }) => {
    try {
        console.log(
            `[DeleteThumb] Starting thumbnail deletion. Filename: ${filename}, Bucket: ${bucket}, Region: ${region}`
        );

        const parsedFileName = parseFileName(filename);
        const thumbFilename = `${parsedFileName.name}_thumb.jpg`;
        const endFileName = join(parsedFileName.dir, thumbFilename);
        const s3 = new s3client.S3Client({ region });
        await s3.send(
            new s3client.DeleteObjectCommand({
                Bucket: bucket,
                Key: endFileName,
            })
        );

        console.log(
            `[DeleteThumb] Thumbnail deletion completed. Filename: ${endFileName}, Bucket: ${bucket}, Region: ${region}`
        );
    } catch (error) {
        console.log(error);
    }
};

module.exports.postdelete = async (event) => {
    await Promise.all(
        event.Records.map((record) =>
            deleteThumb({
                filename: record.s3.object.key,
                bucket: record.s3.bucket.name,
                region: record.awsRegion,
            })
        )
    );
};
