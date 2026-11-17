import { contextBridge, ipcRenderer } from "electron";
import { setupIpc, type SetupAction, type SetupApi, type SetupView } from "../contracts/engine";

const api: SetupApi = {
  getView: () => ipcRenderer.invoke(setupIpc.getView) as Promise<SetupView>,
  action: (id: SetupAction["id"]) => ipcRenderer.invoke(setupIpc.action, id) as Promise<void>,
  onView: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, view: SetupView) => listener(view);
    ipcRenderer.on(setupIpc.view, handler);
    return () => {
      ipcRenderer.removeListener(setupIpc.view, handler);
    };
  },
};

contextBridge.exposeInMainWorld("piSetup", api);
