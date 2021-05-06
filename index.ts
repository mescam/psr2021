import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as storage from "azure-storage";
import { BlobSASPermissions, BlobServiceClient } from "@azure/storage-blob";
import { QueueServiceClient } from "@azure/storage-queue";
import { v4 } from "uuid";
import { ComputerVisionClient } from "@azure/cognitiveservices-computervision";
import { CognitiveServicesCredentials } from "@azure/ms-rest-azure-js";

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

const computerVisionApi = new azure.cognitive.Account("computervision", {
  resourceGroupName: resourceGroup.name,
  kind: "ComputerVision",
  skuName: "F0",
});

// Functions
const listFn = new azure.appservice.HttpFunction("list", {
  route: "list",
  methods: ["GET"],
  callback: async (context, req) => {
    // consts
    const photoTableName = photosTable.name.get();
    const photoContainerName = photosContainer.name.get();
    const connString = connectionString.get();

    // table svc
    const tableService = storage.createTableService(connString);
    const query = new storage.TableQuery();

    const result = await new Promise((resolve, reject) => {
      tableService.queryEntities(
        photoTableName,
        query,
        (null as unknown) as storage.TableService.TableContinuationToken,
        function (error, result, response) {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
    });
    console.log((result as any).entries);
    // [{PartitionKey: { '$': 'Edm.String', _: 'd1d15824-e06e-4b2e-81a7-03c08b9cb2e5' },RowKey: { '$': 'Edm.String', _: '1' },
    // Timestamp: { '$': 'Edm.DateTime', _: 2021-04-29T06:41:24.551Z },processingState: { _: 'QUEUED' },result: { _: false },'.metadata': { etag: `W/"datetime'2021-04-29T06%3A41%3A24.5519623Z'"` }}]
    const entries = (result as any).entries.map((x: any) => ({
      requestId: x.PartitionKey["_"],
      timestamp: x.Timestamp["_"],
      state: x.processingState["_"],
      result: x.result["_"],
    }));

    return {
      status: 200,
      body: entries,
    };
  },
});

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
      Buffer.from(JSON.stringify({ req: requestId })).toString("base64")
    );

    // save to database
    const tableService = storage.createTableService(connString);
    const entGen = storage.TableUtilities.entityGenerator;
    const entry = {
      PartitionKey: entGen.String(requestId),
      RowKey: entGen.String("1"),
      processingState: entGen.String("QUEUED"),
      result: entGen.Boolean(false),
    };
    await new Promise((resolve, reject) => {
      tableService.insertEntity(
        photoTableName,
        entry,
        function (error, result, response) {
          if (!error) {
            resolve(result);
          } else {
            reject(error);
          }
        }
      );
    });

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
    // consts
    const photoTableName = photosTable.name.get();
    const photoContainerName = photosContainer.name.get();
    const connString = connectionString.get();
    const cvKey = computerVisionApi.primaryAccessKey.get();
    const cvEndp = computerVisionApi.endpoint.get();

    // get sas token
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      connString
    );
    const blobClient = blobServiceClient
      .getContainerClient(photoContainerName)
      .getBlobClient(message.req + ".png");
    const sasUrl = await blobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + 86400),
    });
    console.log(sasUrl);

    // process image
    const cvCreds = new CognitiveServicesCredentials(cvKey);
    const cvClient = new ComputerVisionClient(cvCreds, cvEndp);
    const detection = await cvClient.detectObjects(sasUrl, {});
    console.log(detection.objects);

    const result =
      (detection.objects &&
        detection.objects.filter(
          (x) => x.object == "Hot dog" && x.confidence && x.confidence > 0.6
        ).length > 0) ||
      false;

    console.log(result);

    // table svc
    const tableService = storage.createTableService(connString);
    const entGen = storage.TableUtilities.entityGenerator;
    const entry = {
      PartitionKey: entGen.String(message.req),
      RowKey: entGen.String("1"),
      processingState: entGen.String("FINISHED"),
      result: entGen.Boolean(result),
    };
    await new Promise((resolve, reject) => {
      tableService.insertOrMergeEntity(
        photoTableName,
        entry,
        function (error, result, response) {
          if (!error) {
            resolve(result);
          } else {
            reject(error);
          }
        }
      );
    });
  },
});

new azure.appservice.MultiCallbackFunctionApp("application", {
  resourceGroupName: resourceGroup.name,
  functions: [uploadFn, listFn],
});
