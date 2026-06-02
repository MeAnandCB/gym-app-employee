const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    saveExcel: async (fileName, sheets) => ipcRenderer.invoke('save-excel', { fileName, sheets }),
    getReportFolder: async () => ipcRenderer.invoke('get-report-folder'),
    openReportFolder: async () => ipcRenderer.invoke('open-report-folder')
});
