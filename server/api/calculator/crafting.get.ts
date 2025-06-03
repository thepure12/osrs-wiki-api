// crafting.get.ts
import { JSDOM } from "jsdom";
// fs and path are no longer needed for loading name_to_id.json via HTTP
// import * as fs from 'node:fs';
// import * => path from 'node:path';

// Define an interface for the parsed table row data with camelCase naming
interface CraftingAction {
  output: {
    id: number;
    name: string;
  };
  level: number;
  xp: number;
  materials: Array<{
    id: number;
    name: string;
    quantity: number; // This is quantity for 1 craft
  }>;
  gpPerXp: number;
  members: boolean;
  costPerCraft: number;
  craftsPerHour: number;
  xpPerHour: number;
  tool: {
    id: number;
    name: string;
  } | null;
}

// --- Load the item name to ID map once when the server starts ---
// This promise will hold the asynchronously loaded data
let ITEM_NAMES_TO_IDS_PROMISE: Promise<Record<string, number>>;

// Function to asynchronously load the item names to IDs from the public directory
async function loadItemNamesToIds() {
  try {
    // Fetch the file from the public directory via HTTP
    // The path is relative to the base URL of your Nuxt application
    const isDev = process.env.NODE_ENV !== "production";
    const response = await fetch(
      `${
        isDev ? "http://localhost:3001" : "https://osrswiki.pureapps.org"
      }/name_to_id.json`
    );
    if (!response.ok) {
      throw new Error(
        `HTTP error! status: ${response.status} fetching /name_to_id.json`
      );
    }
    const data = await response.json();
    console.log("name_to_id.json loaded successfully via HTTP.");
    return data;
  } catch (error) {
    console.error("Failed to load name_to_id.json via HTTP:", error);
    // Re-throw the error to ensure the serverless function initialization fails
    // if this critical data cannot be loaded.
    throw new Error(
      "Failed to initialize application: Could not fetch name_to_id.json."
    );
  }
}

// Assign the promise to the global variable.
// This function will execute when the serverless function "cold starts".
ITEM_NAMES_TO_IDS_PROMISE = loadItemNamesToIds();
// --- End of map loading ---

export default defineEventHandler(async (event) => {
  // Await the promise to ensure the data is loaded before proceeding with the request
  const ITEM_NAMES_TO_IDS = await ITEM_NAMES_TO_IDS_PROMISE;

  const query = getQuery(event);
  const currentLevel = parseInt(query.current as string) || 1;
  const goalLevel = parseInt(query.goal as string) || 99;

  const baseUrl = "https://oldschool.runescape.wiki/api.php";

  const textParam = `{{Calculator:Skill calc/Template|name=PurePlugins|currentToggle=Level|current=${currentLevel}|goalToggle=Level|goal=${goalLevel}|method=All|dataCriteria=Show All|skill=Crafting}}`;

  const apiParams = {
    action: "parse",
    text: textParam,
    prop: "text|limitreportdata",
    title: "Calculator:Crafting",
    disablelimitreport: "true",
    contentmodel: "wikitext",
    format: "json",
  };

  const queryParams = new URLSearchParams(apiParams as Record<string, string>);
  const url = `${baseUrl}?${queryParams.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    const htmlString = data.parse.text["*"];

    const dom = new JSDOM(htmlString);
    const doc = dom.window.document;

    const table = doc.querySelector(".wikitable.sortable");
    if (!table) {
      console.error(
        "Table not found in the response HTML. Check the API response or selector."
      );
      return [];
    }

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const parsedData: CraftingAction[] = [];

    const parseCurrency = (text: string): number => {
      let cleanedText = text.replace(/[^0-9.\-—]/g, "");
      if (cleanedText.includes("—")) return 0;
      if (cleanedText.startsWith("−"))
        return -parseFloat(cleanedText.substring(1));
      return parseFloat(cleanedText);
    };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = Array.from(row.querySelectorAll("td"));
      const rowData = {} as CraftingAction;

      // Column 0 & 1: Output Item (Name and ID)
      const outputName =
        cells[1]?.querySelector("a")?.textContent?.trim() ||
        cells[1]?.textContent?.trim() ||
        "";
      const outputId = ITEM_NAMES_TO_IDS[outputName] || 0;
      rowData.output = {
        id: outputId,
        name: outputName,
      };

      // Column 2: Level - Now parsed as a number
      rowData.level = parseInt(cells[2]?.textContent?.trim() || "0");

      // Column 3: XP
      rowData.xp = parseFloat(cells[3]?.textContent?.trim() || "0");

      // Column 4: # Needed - Parsed internally for calculations, but not added to rowData
      const neededCrafts = parseInt(
        cells[4]?.textContent?.trim()?.replace(/,/g, "") || "0"
      );

      // Column 5: Materials (Name, Quantity per craft, and ID)
      const materials: Array<{ id: number; name: string; quantity: number }> =
        [];
      const materialsCell = cells[5];
      if (materialsCell) {
        const materialSpans = materialsCell.querySelectorAll(
          'span[typeof="mw:File"]'
        );
        materialSpans?.forEach((span) => {
          const materialImg = span.querySelector("img");
          const materialLink = span.nextElementSibling as HTMLAnchorElement;
          if (materialImg && materialLink) {
            const cellHTML = materialsCell.innerHTML;
            const materialName = materialLink.textContent?.trim() || "";
            const regex = new RegExp(
              `(\\d+,?\\d*)\\s*×\\s*<span[^>]*><a[^>]*href="/w/${materialName.replace(
                / /g,
                "_"
              )}"[^>]*><img[^>]*src="${materialImg.src.replace(
                /[-\/\\^$*+?.()|[\]{}]/g,
                "\\$&"
              )}"[^>]*></a></span> <a[^>]*href="/w/${materialName.replace(
                / /g,
                "_"
              )}"[^>]*>${materialName}</a>`
            );
            const match = cellHTML.match(regex);

            let totalQuantity = 1;
            if (match && match[1]) {
              totalQuantity = parseInt(match[1].replace(/,/g, ""), 10);
            }

            let quantityPerCraft = 0;
            if (neededCrafts > 0) {
              quantityPerCraft = totalQuantity / neededCrafts;
            }

            const materialId = ITEM_NAMES_TO_IDS[materialName] || 0;

            materials.push({
              id: materialId,
              name: materialName,
              quantity: quantityPerCraft,
            });
          }
        });
      }
      rowData.materials = materials;

      // Column 6: Input Cost - Parsed internally for costPerCraft
      const inputCost = parseCurrency(cells[6]?.textContent || "");

      // Column 9: GP/XP
      rowData.gpPerXp = parseCurrency(cells[9]?.textContent || "");

      // Column 10: Members (boolean)
      rowData.members = !!cells[10]?.querySelector(
        'img[src*="Member_icon.png"]'
      );

      // costPerCraft calculation
      rowData.costPerCraft = neededCrafts > 0 ? inputCost / neededCrafts : 0;

      // Determine craftsPerHour based on item type
      const outputNameLower = outputName.toLowerCase();
      const materialsUsedLower = rowData.materials.map(m => m.name.toLowerCase());

      // Check if material contains an uncut gem
      const hasUncutGemMaterial = materialsUsedLower.some(material => material.includes("uncut "));

      if (hasUncutGemMaterial) {
        rowData.craftsPerHour = 2780; // Uncut gems (if material is an uncut gem)
      } else if (outputNameLower.includes("battlestaff")) {
        rowData.craftsPerHour = 2625; // All battle staffs
      } else if (outputNameLower.includes("dragonhide body")) {
        rowData.craftsPerHour = 1685; // All dragonhide bodies
      } else if (outputNameLower.includes("glass")) {
        rowData.craftsPerHour = 1750; // All glass items
      } else if (
        (outputNameLower.includes("ring") ||
          outputNameLower.includes("necklace") ||
          outputNameLower.includes("amulet") ||
          outputNameLower.includes("bracelet"))
      ) {
          // Check for gems in materials (for jewellery)
          const hasGemMaterial = materialsUsedLower.some(material =>
              material.includes("uncut ") || // Common prefix for uncut gems
              material.includes("sapphire") ||
              material.includes("emerald") ||
              material.includes("ruby") ||
              material.includes("diamond") ||
              material.includes("dragonstone") ||
              material.includes("onyx") ||
              material.includes("zenyte")
          );
          const hasBarMaterial = materialsUsedLower.some(material => material.includes("bar"));

          if (hasGemMaterial) {
              rowData.craftsPerHour = 1400; // All jewellery with a gem
          } else if (hasBarMaterial) {
              rowData.craftsPerHour = 1600; // All jewellery with just a bar
          } else {
              rowData.craftsPerHour = 0; // Default or unknown jewellery type
          }
      } else {
        rowData.craftsPerHour = 0; // Default for uncategorized items
      }

      // Calculate xpPerHour
      rowData.xpPerHour = rowData.craftsPerHour * rowData.xp;


      // Determine the tool needed (ID and Name), with mould logic
      let toolNeeded: { id: number; name: string } | null = null;

      if (materialsUsedLower.some((name) => name.includes("bar"))) {
        if (outputNameLower.includes("ring")) {
          const toolName = "Ring mould";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (outputNameLower.includes("necklace")) {
          const toolName = "Necklace mould";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (outputNameLower.includes("amulet")) {
          const toolName = "Amulet mould";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (outputNameLower.includes("bracelet")) {
          const toolName = "Bracelet mould";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        }
      }

      if (!toolNeeded) {
        if (
          materialsUsedLower.some(
            (name) => name.includes("leather") || name.includes("fabric")
          )
        ) {
          const toolName = "Needle";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (
          materialsUsedLower.some(
            (name) => name.includes("uncut") || name.includes("shell")
          )
        ) {
          const toolName = "Chisel";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (materialsUsedLower.some((name) => name.includes("nails"))) {
          const toolName = "Hammer";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        } else if (
          materialsUsedLower.some((name) => name.includes("molten glass"))
        ) {
          const toolName = "Glassblowing pipe";
          toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
        }
      }
      rowData.tool = toolNeeded;

      parsedData.push(rowData);
    }

    // Sort the data by 'gpPerXp' in descending order (highest to lowest)
    parsedData.sort((a, b) => {
      const gpXpA = typeof a.gpPerXp === "number" ? a.gpPerXp : 0;
      const gpXpB = typeof b.gpPerXp === "number" ? b.gpPerXp : 0;
      return gpXpB - gpXpA;
    });

    return parsedData;
  } catch (error) {
    console.error("Failed to fetch or parse data:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to retrieve crafting data",
      data: error instanceof Error ? error.message : String(error),
    });
  }
});