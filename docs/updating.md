# Updating

If you sync your vault (for example with Obsidian Sync), keep Task Time Tracker on the same version on all your devices.

## Version notes

**Update it on every device now:** 0.0.35 stores clients as their own list, and a device still on 0.0.33 or earlier would remove the clients list and each task's client the next time it saves. If that happens, the plugin tells you and recovers the clients from your projects, but client changes made in between are lost. Devices on 0.0.34 keep the new data intact: they ask you to update the plugin there and disable exporting and editing projects and clients until you do. But assigning a project to a task from a 0.0.34 device leaves that task without a client.

Devices on 0.0.34 to 0.0.36 ignore Tracking folders and project folders: their History and exports show the project you set by hand, and the play button shows in the whole vault. Nothing is lost when you go back to 0.0.37. Update every device before exporting, so your exports use the projects set by folder.

For everything that changed in each version, see the [CHANGELOG](../CHANGELOG.md).

---

[← Documentation index](README.md)
