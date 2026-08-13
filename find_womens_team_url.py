import os
import time
import urllib.error
import urllib.parse
import urllib.request
import json
import xlwings as xw

EXCEL_FILE = "WomensSummitTPE.xlsx"
TEAMS_SHEET = "Teams"

# Recommended: store your key in an environment variable named SERPAPI_KEY.
# PowerShell example:
# $env:SERPAPI_KEY = "your_key_here"
SERPAPI_KEY = os.getenv(
    "SERPAPI_KEY",
    "429dcf4a541bcde87a20a9e2700a2f3b8bfe193e528842398fb2df3ec6900356"
)

TEAM_NAME_COLUMN = "A"
STATS_URL_COLUMN = "C"
SITE_TYPE_COLUMN = "D"


def google_search_first_link(query):
    """Search Google through SerpAPI and return the first organic result."""
    url = "https://serpapi.com/search"

    params = {
        "engine": "google",
        "q": query,
        "api_key": SERPAPI_KEY,
        "num": 10
    }

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()

    data = response.json()
    results = data.get("organic_results", [])

    if not results:
        return ""

    return results[0].get("link", "")


def determine_site_type(link):
    """Determine the athletics website platform from the result URL."""
    lower_link = link.lower()

    sidearm_patterns = [
        "/sports/womens-basketball/",
        "/sports/w-baskbl/",
        "/sports/womens/basketball/",
        "/sports/wbasketball/"
    ]

    if any(pattern in lower_link for pattern in sidearm_patterns):
        return "Sidearm"

    return ""


if SERPAPI_KEY == "PASTE_YOUR_SERPAPI_KEY_HERE":
    raise ValueError(
        "Add your SerpAPI key to the SERPAPI_KEY environment variable "
        "or replace PASTE_YOUR_SERPAPI_KEY_HERE in the script."
    )


wb = xw.Book(EXCEL_FILE)
sheet = wb.sheets[TEAMS_SHEET]

last_row = (
    sheet.range(f"{TEAM_NAME_COLUMN}{sheet.cells.last_cell.row}")
    .end("up")
    .row
)

for row in range(2, last_row + 1):
    team_name = sheet.range(f"{TEAM_NAME_COLUMN}{row}").value
    existing_url = sheet.range(f"{STATS_URL_COLUMN}{row}").value

    if not team_name:
        continue

    if existing_url:
        print(f"Skipping row {row}: {team_name} already has a URL.")
        continue

    query = f'"{team_name}" 2025-26 women\'s basketball stats'

    print(f"\nSearching row {row}: {query}")

    try:
        link = google_search_first_link(query)

        if link:
            sheet.range(f"{STATS_URL_COLUMN}{row}").value = link

            site_type = determine_site_type(link)

            if site_type:
                sheet.range(f"{SITE_TYPE_COLUMN}{row}").value = site_type

            print(f"Found: {link}")

            if site_type:
                print(f"Site type: {site_type}")
        else:
            print("No result found.")

    except requests.RequestException as error:
        print(f"Search request error for {team_name}: {error}")

    except Exception as error:
        print(f"Error processing {team_name}: {error}")

    # Save after each team so progress is retained if the script stops.
    wb.save()

    # Helps reduce the likelihood of rate-limit errors.
    time.sleep(1)

wb.save()
print("\nDone.")