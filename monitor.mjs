import { chromium } from "playwright";

const TARGET_DATE = process.env.TARGET_DATE || "2 Aug";
const SITE_URL = "https://ticket.cineplexbd.com/home";
const MAX_LOGIN_ATTEMPTS = 3;

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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

function shortDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);

  if (!match) {
    return null;
  }

  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  return month ? `${day} ${month}` : null;
}

async function pageSummary(page, response) {
  const title = await page.title().catch(() => "");
  const text = await page
    .locator("body")
    .innerText()
    .then((value) => value.replace(/\s+/g, " ").slice(0, 500))
    .catch(() => "");

  return [
    `status=${response?.status() ?? "unknown"}`,
    `url=${page.url()}`,
    `title=${JSON.stringify(title)}`,
    `text=${JSON.stringify(text)}`
  ].join(", ");
}

async function openGuestSession(browser) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
    const context = await browser.newContext({
      locale: "en-BD",
      timezoneId: "Asia/Dhaka"
    });
    const page = await context.newPage();
    let navigationResponse;

    try {
      navigationResponse = await page.goto(SITE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });

      const firstTheatre = page.getByText(THEATRES[0]);
      const guestLogin = page
        .locator("button")
        .filter({ hasText: /guest login/i })
        .first();

      const screen = await Promise.race([
        firstTheatre
          .waitFor({ state: "visible", timeout: 45_000 })
          .then(() => "theatres"),
        guestLogin
          .waitFor({ state: "visible", timeout: 45_000 })
          .then(() => "login")
      ]);

      if (screen === "login") {
        await guestLogin.click();
        await firstTheatre.waitFor({ state: "visible", timeout: 45_000 });
      }

      return { context, page };
    } catch (error) {
      const summary = await pageSummary(page, navigationResponse);
      lastError = `${errorMessage(error)}; ${summary}`;
      await context.close();

      if (attempt < MAX_LOGIN_ATTEMPTS) {
        console.warn(
          `Retrying Cineplex guest login after attempt ${attempt} failed — ${lastError}`
        );
      }
    }
  }

  throw new Error(
    `Cineplex guest login failed after ${MAX_LOGIN_ATTEMPTS} attempts — ${lastError}`
  );
}

async function openTheatrePicker(page, selectedTheatre) {
  const pickerHeading = page.getByText("Select your Theatre", { exact: true });

  if (await pickerHeading.isVisible()) {
    return;
  }

  if (!selectedTheatre) {
    throw new Error("The theatre picker is not open");
  }

  await page
    .getByRole("link", { name: selectedTheatre, exact: true })
    .click();
  await pickerHeading.waitFor({ state: "visible", timeout: 20_000 });
}

async function checkTheatre(page, theatre, selectedTheatre) {
  try {
    await openTheatrePicker(page, selectedTheatre);

    // The card includes the address in the same element as the theatre name.
    const theatreChoice = page.getByText(theatre);
    await theatreChoice.waitFor({ state: "visible", timeout: 30_000 });

    const showDatesResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/get-showdate") && response.status() === 200,
      { timeout: 20_000 }
    );
    const [response] = await Promise.all([
      showDatesResponse,
      theatreChoice.click()
    ]);

    await page
      .getByRole("link", { name: theatre, exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });

    const payload = await response.json();

    if (payload.status !== "success" || !Array.isArray(payload.data)) {
      throw new Error(
        `Unexpected show-date response: ${JSON.stringify(payload).slice(0, 500)}`
      );
    }

    const targetDate = TARGET_DATE.trim().toLowerCase();
    const available = payload.data.some(
      (entry) => shortDate(entry.showDate)?.toLowerCase() === targetDate
    );

    return {
      theatre,
      available,
      error: null,
      selected: true
    };
  } catch (error) {
    const selected = await page
      .getByRole("link", { name: theatre, exact: true })
      .isVisible()
      .catch(() => false);

    return {
      theatre,
      available: false,
      error: errorMessage(error),
      selected
    };
  }
}

const browser = await chromium.launch({ headless: true });
let context;

try {
  const session = await openGuestSession(browser);
  context = session.context;
  const page = session.page;
  const results = [];
  let selectedTheatre = null;

  for (const theatre of THEATRES) {
    const result = await checkTheatre(page, theatre, selectedTheatre);
    results.push(result);

    if (result.selected) {
      selectedTheatre = theatre;
    }

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
} catch (error) {
  const message = errorMessage(error);
  console.error(message);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import("node:fs");
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## Cineplex monitor failure",
        "",
        "```text",
        message.replace(/```/g, "'''"),
        "```",
        ""
      ].join("\n")
    );
  }

  process.exitCode = 1;
} finally {
  await context?.close();
  await browser.close();
}
