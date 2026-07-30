import { chromium } from "playwright";

const TARGET_DATE = process.env.TARGET_DATE || "2 Aug";
const SITE_URL = "https://ticket.cineplexbd.com/home";
const MAX_ATTEMPTS = 3;

const THEATRES = [
  "Bashundhara Shopping Mall, Panthapath",
  "Shimanto Shambhar, Dhanmondi 2",
  "Star Cineplex, SKS Tower, Mohakhali",
  "Sony Square, Mirpur",
  "Bangladesh Military Museum, Bijoy Shoroni",
  "Bali Arcade, Chattogram",
  "Centrepoint, Uttara",
  "Shimanto Tower, Narayanganj",
  "Finlay Square, Chattogram"
];

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function checkTheatreOnce(browser, theatre) {
  const page = await browser.newPage();

  try {
    await page.goto(SITE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });

    const guestLogin = page.getByRole("button", {
      name: "Guest Login",
      exact: true
    });

    await guestLogin.waitFor({ state: "visible", timeout: 20_000 });
    await guestLogin.click();

    // The Cineplex card includes the address in the same element as the theatre
    // name, so an exact-text locator never matches even though the name is shown.
    const theatreChoice = page.getByText(theatre);
    await theatreChoice.waitFor({ state: "visible", timeout: 30_000 });
    await theatreChoice.click();

    await page
      .getByRole("heading", { name: "Select Date", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });

    const pageText = await page.locator("body").innerText();
    const datePattern = new RegExp(`\\b${escapeRegex(TARGET_DATE)}\\b`, "i");

    return {
      theatre,
      available: datePattern.test(pageText),
      error: null
    };
  } finally {
    await page.close();
  }
}

async function checkTheatre(browser, theatre) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await checkTheatreOnce(browser, theatre);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `Retrying ${theatre} after attempt ${attempt} failed — ${lastError}`
        );
      }
    }
  }

  return {
    theatre,
    available: false,
    error: `Failed after ${MAX_ATTEMPTS} attempts — ${lastError}`
  };
}

const browser = await chromium.launch({ headless: true });

try {
  const results = [];

  for (const theatre of THEATRES) {
    const result = await checkTheatre(browser, theatre);
    results.push(result);
    console.log(
      `${result.available ? "AVAILABLE" : result.error ? "ERROR" : "not yet"}: ${theatre}` +
        (result.error ? ` — ${result.error}` : "")
    );
  }

  const availableAt = results
    .filter((result) => result.available)
    .map((result) => result.theatre);
  const failures = results.filter((result) => result.error);
  const found = availableAt.length > 0;

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `found=${found}\n`);
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `locations=${availableAt.join(", ")}\n`
    );
  }

  if (!found && failures.length === THEATRES.length) {
    console.error("Every theatre check failed.");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
