import electron from "electron";
import { app, BrowserWindow } from "electron";


app.on('ready', () => {
  let win = new BrowserWindow({width: 800, height: 600});
  win.loadURL(`file://${__dirname}/index.html`);
})
