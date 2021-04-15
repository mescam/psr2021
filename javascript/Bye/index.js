const { BlobServiceClient } = require("@azure/storage-blob");
const { v4 } = require("uuid");

module.exports = async function (context, req) {
    const body = req.body;

    // constants
    const connString = process.env["PhotoContainerConnString"];
    const photoContainerName = process.env["PhotoContainerName"];
    const requestId = v4();

    // variables from input
    const photo = Buffer.from(body.photo, 'base64')
    const fileName = body.name;

    // connect to azure blob storage
    const blobServiceClient = BlobServiceClient.fromConnectionString(connString);
    const container = blobServiceClient.getContainerClient(photoContainerName);
    const result = await container.uploadBlockBlob(`${requestId}.png`, photo, photo.length);

    // output 
    context.res = {
        status: 200,
        body: {
            "requestId": requestId
        }
    }
}