import { EventBus } from "./src/core/eventBus.ts";
import { DashboardServer } from "./src/dashboard/DashboardServer.ts";
const bus = new EventBus({ eventsDir: ".scale/events" });
new DashboardServer(bus, { port: 3011 }).start();
setInterval(() => {}, 1 << 30);
