import { createFileRoute } from "@tanstack/react-router";
import demoHtml from "@/legacy/demo.html?raw";
import answerModule from "@/legacy/demo-stream.js?raw";

// Single source of truth: the answer-delivery module is unit tested and
// inlined into the static demo page at request time.
const html = demoHtml.replace("/*__APLYER_ANSWER_MODULE__*/", () => answerModule);

export const Route = createFileRoute("/demo")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    },
  },
});
