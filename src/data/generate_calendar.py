"""Regenerate or check the bounded NYSE daily-session snapshot.

Run in the locked verification environment. Bounds through 2028 were reviewed
against NYSE's official 2026/2027/2028 holiday table on 2026-10-06. Future
extraordinary closures still require a source-reviewed snapshot update.
"""
import argparse
import json
from pathlib import Path

import exchange_calendars as xcals
import pandas as pd

def generate():
    if xcals.__version__ != "4.13.2":
        raise RuntimeError("Use the recorded exchange-calendars==4.13.2 reference version.")
    start, end = "1990-01-01", "2028-12-31"
    calendar = xcals.get_calendar("XNYS", start=start, end=end)
    sessions = set(calendar.sessions.strftime("%Y-%m-%d"))
    closed_weekdays = [date.strftime("%Y-%m-%d") for date in pd.bdate_range(start, end)
                       if date.strftime("%Y-%m-%d") not in sessions]
    return {
        "calendar": "XNYS",
        "start": start,
        "end": end,
        "verifiedAt": "2026-10-06",
        "referenceVersion": f"exchange-calendars {xcals.__version__}",
        "sources": [
            "https://www.nyse.com/trade/hours-calendars",
            "https://www.nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf",
            "https://www.nyse.com/publicdocs/nyse/markets/american-options/rule-interpretations/2025/National_Day_of_Mourning_20250102.pdf",
            "https://github.com/gerrymanoim/exchange_calendars",
        ],
        "notes": "Daily US equity sessions, including early-close days. Scheduled 2026-2028 holidays were checked against NYSE's official table. Future extraordinary closures need a source-reviewed calendar update. No intraday trading-hour claims.",
        "closedWeekdays": closed_weekdays,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("us-equity-calendar.json"), help="Destination, or reference path when using --check.")
    parser.add_argument("--check", action="store_true", help="Regenerate in memory and compare exactly without writing files.")
    args = parser.parse_args()
    result = generate()
    if args.check:
        try:
            reference = json.loads(args.output.read_text())
            if result != reference:
                raise ValueError("snapshot differs from the reviewed generator")
        except (OSError, ValueError) as error:
            parser.exit(1, f"Calendar verification failed: {error}\n")
        print(json.dumps(dict(status="verified", start=result["start"], end=result["end"], closures=len(result["closedWeekdays"]))))
        return
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(dict(status="generated", start=result["start"], end=result["end"], closures=len(result["closedWeekdays"]))))


if __name__ == "__main__":
    main()
