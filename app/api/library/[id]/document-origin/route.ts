// Recovery uses a distinct path outside the document cache-function trigger.
// Reuse the original handler so session, visibility and reader identity checks
// remain identical; the response is always private and uncacheable.
export { GET } from "../document/route"
