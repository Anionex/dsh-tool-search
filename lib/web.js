/** Read-only live catalog endpoint for the Web settings page. */
import { TOOL_SEARCH_CATALOG_ROUTE } from "./shared.js";
function sendJson(res, status, value) {
    const body = Buffer.from(JSON.stringify(value));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(status);
    res.end(body);
}
export function installCatalogRoute(ctx, runtime) {
    ctx.inject(['webServer'], webCtx => {
        webCtx.effect(() => webCtx.webServer.register({
            kind: 'exact',
            path: TOOL_SEARCH_CATALOG_ROUTE,
            handler: (req, res) => {
                if (req.method !== 'GET') {
                    res.setHeader('Allow', 'GET');
                    sendJson(res, 405, { error: 'method-not-allowed' });
                    return;
                }
                sendJson(res, 200, runtime.snapshot());
            },
        }), 'dsh-tool-search: Web catalog route');
    });
}
//# sourceMappingURL=web.js.map