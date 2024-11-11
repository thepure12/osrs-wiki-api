import { JSDOM } from "jsdom";
export default defineEventHandler(async (event) => {
    const wikiBaseUrl = "https://oldschool.runescape.wiki"
    const itemId = getRouterParam(event, "id")
    const searchUrl = `${wikiBaseUrl}/?search=ID: ${itemId}`
    const html: string = await $fetch(searchUrl)
    const dom = new JSDOM(html)
    // return html
    const li = dom.window.document.querySelector(".mw-search-result-heading")
    const itemPath = li?.querySelector("a")?.href
    const itemHtml: string = await $fetch(`${wikiBaseUrl}${itemPath}`)
    const itemDom = new JSDOM(itemHtml)
    return itemDom.window.document.querySelector("body")?.innerHTML
});
