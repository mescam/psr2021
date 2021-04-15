import * as pulumi from "@pulumi/pulumi";
import * as resources from "@pulumi/azure-native/resources";
import * as storage from "@pulumi/azure-native/storage";
import * as web from "@pulumi/azure-native/web";
import * as helpers from "./helpers";

// Create an Azure Resource Group
const resourceGroup = new resources.ResourceGroup("resourceGroup", {
    resourceGroupName: "sandbox-jakub-wozniak-1"
});

// Create an Azure resource (Storage Account)
const storageAccount = new storage.StorageAccount("sa", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: storage.SkuName.Standard_LRS,
    },
    kind: storage.Kind.StorageV2,
});

// Blob container - code
const codeContainer = new storage.BlobContainer("codecontainer", {
    accountName: storageAccount.name,
    resourceGroupName: resourceGroup.name
});

const codeBlob = new storage.Blob("zip", {
    resourceGroupName: resourceGroup.name,
    accountName: storageAccount.name,
    containerName: codeContainer.name,
    source: new pulumi.asset.FileArchive("./javascript")
});

const plan = new web.AppServicePlan("plan", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "Y1",
        tier: "Dynamic"
    }
});

const storageConnectionString = helpers.getConnectionString(resourceGroup.name, storageAccount.name);
const codeBlobUrl = helpers.signedBlobReadUrl(codeBlob, codeContainer, storageAccount, resourceGroup);

// Blob container for photos
const photosContainer = new storage.BlobContainer("photoscontainer", {
    accountName: storageAccount.name,
    resourceGroupName: resourceGroup.name,
    containerName: "photos"
});


const app = new web.WebApp("fa", {
    resourceGroupName: resourceGroup.name,
    serverFarmId: plan.id,
    kind: "functionapp",
    siteConfig: {
        appSettings: [
            { name: "AzureWebJobsStorage", value: storageConnectionString },
            { name: "FUNCTIONS_EXTENSION_VERSION", value: "~3" },
            { name: "FUNCTIONS_WORKER_RUNTIME", value: "node" },
            { name: "WEBSITE_NODE_DEFAULT_VERSION", value: "~14" },
            { name: "WEBSITE_RUN_FROM_PACKAGE", value: codeBlobUrl },
            { name: "PhotoContainerConnString", value: storageConnectionString }, 
            { name: "PhotoContainerName", value: photosContainer.name }
        ],
        http20Enabled: true,
        nodeVersion: "~14",
    },
});





