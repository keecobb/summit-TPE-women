import xlwings as xw

EXCEL_FILE = "HoopSourceStats.xlsx"

GAME_STATS_SHEET = "PlayerGameStats"
MAPPING_SHEET = "UnknownOpponents"

wb = xw.Book(EXCEL_FILE)

games_sheet = wb.sheets[GAME_STATS_SHEET]
mapping_sheet = wb.sheets[MAPPING_SHEET]

data = mapping_sheet.used_range.value

if not data or len(data) < 2:
    print("No mappings found.")
    exit()

headers = data[0]
unknown_idx = headers.index("Unknown Opponent")
update_idx = headers.index("Update To")

name_map = {}

for row in data[1:]:
    if not row:
        continue

    old_name = str(row[unknown_idx] or "").strip()
    new_name = str(row[update_idx] or "").strip()

    if old_name and new_name:
        name_map[old_name.lower()] = new_name

if not name_map:
    print("No completed mappings found in Update To column.")
    exit()

games_last = games_sheet.range("D" + str(games_sheet.cells.last_cell.row)).end("up").row
opponent_range = games_sheet.range(f"D2:D{games_last}")
opponents = opponent_range.value

if not isinstance(opponents, list):
    opponents = [opponents]

updated_count = 0
new_values = []

for value in opponents:
    original = str(value or "").strip()
    key = original.lower()

    if key in name_map:
        new_values.append([name_map[key]])
        updated_count += 1
    else:
        new_values.append([value])

opponent_range.value = new_values

wb.save()
print(f"Updated {updated_count} opponent rows.")