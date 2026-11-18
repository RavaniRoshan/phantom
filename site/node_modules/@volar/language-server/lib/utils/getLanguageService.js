"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLanguageService = getLanguageService;
/**
 * A project that fails to provide a language service fails only the request or diagnostics pass
 * that asked for it; the error is logged instead of becoming an unhandled rejection.
 */
async function getLanguageService(connection, project, uri) {
    try {
        return await project.getLanguageService(uri);
    }
    catch (error) {
        connection.console.error(`Failed to get the language service for ${uri.toString()}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
}
//# sourceMappingURL=getLanguageService.js.map