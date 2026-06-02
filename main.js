const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const reportFolder = path.join(app.getPath('documents'), 'report');

function ensureReportFolder() {
    fs.mkdirSync(reportFolder, { recursive: true });
    return reportFolder;
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 840,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.removeMenu();
}

app.whenReady().then(() => {
    ensureReportFolder();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('save-excel', async (event, { fileName, sheets }) => {
    ensureReportFolder();
    const filePath = path.join(reportFolder, fileName);
    const workbook = XLSX.utils.book_new();
    sheets.forEach((sheet) => {
        const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: sheet.headers });
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name || 'Sheet1');
    });
    XLSX.writeFile(workbook, filePath);
    return { filePath };
});

ipcMain.handle('get-report-folder', async () => {
    ensureReportFolder();
    return reportFolder;
});

ipcMain.handle('open-report-folder', async () => {
    ensureReportFolder();
    await shell.openPath(reportFolder);
    return reportFolder;
});
