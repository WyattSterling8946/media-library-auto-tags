import { chooseTags } from "./media_tagging_service";

const result = chooseTags("forest-retreat.jpg", { title: "Mountain forest" });
if (result.join(",") !== "landscape") throw new Error(`Unexpected tags: ${result.join(",")}`);
console.log("decision test passed");
