import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import { defaultSettings } from "./oai-files.constants.ts";
import { getOaiFilesDescription } from "./oai-files.description.ts";
import {
  listFilesWorkspace, listFilesOrchestration, listFilesAgent, listFilesLayer,
  getDownloadUrlWorkspace, getDownloadUrlOrchestration, getDownloadUrlAgent, getDownloadUrlLayer,
  getUploadUrlWorkspace, getUploadUrlOrchestration, getUploadUrlAgent, getUploadUrlLayer,
  deleteFileWorkspace, deleteFileOrchestration, deleteFileAgent, deleteFileLayer,
  createDirWorkspace, createDirOrchestration, createDirAgent, createDirLayer,
  deleteDirWorkspace, deleteDirOrchestration, deleteDirAgent, deleteDirLayer,
  getFileMetadataWorkspace, getFileMetadataOrchestration, getFileMetadataAgent, getFileMetadataLayer,
} from "./oai-files.service.ts";

export const oaiFilesService = defineServiceWithDynamicDescription({
  unique_name: "oai-files",
  service_name: "OAI Files",
  service_description: "Read, write, and manage files across workspace, orchestration, agent, and layer storage scopes.",
  defaultSettings,
  description: getOaiFilesDescription,
  tools: {
    list_files_workspace: listFilesWorkspace,
    list_files_orchestration: listFilesOrchestration,
    list_files_agent: listFilesAgent,
    list_files_layer: listFilesLayer,

    get_download_url_workspace: getDownloadUrlWorkspace,
    get_download_url_orchestration: getDownloadUrlOrchestration,
    get_download_url_agent: getDownloadUrlAgent,
    get_download_url_layer: getDownloadUrlLayer,

    get_upload_url_workspace: getUploadUrlWorkspace,
    get_upload_url_orchestration: getUploadUrlOrchestration,
    get_upload_url_agent: getUploadUrlAgent,
    get_upload_url_layer: getUploadUrlLayer,

    delete_file_workspace: deleteFileWorkspace,
    delete_file_orchestration: deleteFileOrchestration,
    delete_file_agent: deleteFileAgent,
    delete_file_layer: deleteFileLayer,

    create_dir_workspace: createDirWorkspace,
    create_dir_orchestration: createDirOrchestration,
    create_dir_agent: createDirAgent,
    create_dir_layer: createDirLayer,

    delete_dir_workspace: deleteDirWorkspace,
    delete_dir_orchestration: deleteDirOrchestration,
    delete_dir_agent: deleteDirAgent,
    delete_dir_layer: deleteDirLayer,

    get_file_metadata_workspace: getFileMetadataWorkspace,
    get_file_metadata_orchestration: getFileMetadataOrchestration,
    get_file_metadata_agent: getFileMetadataAgent,
    get_file_metadata_layer: getFileMetadataLayer,
  },
});
