import { McpManager } from './manager'

/** One connection manager per page; MCP clients are shared across chats. */
export const mcp = new McpManager(__TARGET__)
