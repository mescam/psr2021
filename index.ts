import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import { createTableService } from "azure-storage";
import { BlobServiceClient } from "@azure/storage-blob";
import { QueueServiceClient } from "@azure/storage-queue";
import { v4 } from "uuid";

// Create an Azure Resource Group
const resourceGroup = new azure.core.ResourceGroup("resourceGroup", {
  name: "jakub-wozniak-sandbox-3",
});

// Create an Azure resource (Storage Account)
const account = new azure.storage.Account("storage", {
  // The location for the storage account will be derived automatically from the resource group.
  resourceGroupName: resourceGroup.name,
  accountTier: "Standard",
  accountReplicationType: "LRS",
});

// Export the connection string for the storage account
export const connectionString = account.primaryConnectionString;

const photosContainer = new azure.storage.Container("photoscontainer", {
  storageAccountName: account.name,
  name: "photos",
});

const photosQueue = new azure.storage.Queue("photosqueue", {
  storageAccountName: account.name,
  name: "photos-queue",
});

const photosTable = new azure.storage.Table("photostable", {
  storageAccountName: account.name,
  name: "photos",
});

// Functions

const uploadFn = new azure.appservice.HttpFunction("upload", {
  route: "upload",
  methods: ["POST"],
  callback: async (context, req) => {
    const body = req.body;

    // constants
    const connString = connectionString.get();
    const photoContainerName = photosContainer.name.get();
    const photoQueueName = photosQueue.name.get();
    const photoTableName = photosTable.name.get();
    const requestId = v4();

    // variables from input
    const photo = Buffer.from(body.photo, "base64");
    const fileName = body.name;

    // connect to azure blob storage
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      connString
    );
    const container = blobServiceClient.getContainerClient(photoContainerName);
    const result = await container.uploadBlockBlob(
      `${requestId}.png`,
      photo,
      photo.length
    );

    // add job to queue
    const queueServiceClient = QueueServiceClient.fromConnectionString(
      connString
    );
    const queue = queueServiceClient.getQueueClient(photoQueueName);
    await queue.sendMessage(
      new Buffer(JSON.stringify({ req: requestId })).toString("base64")
    );

    // save to database
    const tableService = createTableService(connString);

    // output
    return {
      status: 200,
      body: {
        requestId: requestId,
      },
    };
  },
});

photosQueue.onEvent("newPhotoFn", {
  callback: async (context, message) => {
    console.log("hello ->" + message);
  },
});

new azure.appservice.MultiCallbackFunctionApp("application", {
  resourceGroupName: resourceGroup.name,
  functions: [uploadFn],
});
