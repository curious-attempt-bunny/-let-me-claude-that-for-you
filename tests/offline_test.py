"""Offline sanity checks for madlib.py, run with plain CPython before wiring
into Pyodide. Usage: python3 tests/offline_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nltk

nltk.data.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "data", "nltk_data"))

import madlib

QUESTIONS = [
    "Why does my cat knock everything off the table at 3am?",
    "How do I convince my boss to approve my vacation request?",
    "What is the meaning of life?",
    "Should I eat the last slice of pizza in the office fridge?",
]


def main():
    templates = madlib.load_templates(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "templates.json"))

    failures = []

    for q in QUESTIONS:
        nouns = madlib.extract_nouns(q)
        assert isinstance(nouns, list), f"extract_nouns did not return a list for: {q}"

        answer = madlib.generate_answer(q, templates)
        if not answer or len(answer.strip()) < 10:
            failures.append(f"Empty/short answer for: {q!r} -> {answer!r}")
        if "{" in answer or "}" in answer:
            failures.append(f"Unfilled template placeholder in: {answer!r}")

        session = madlib.generate_session(q, templates)
        if not session["first_answer"]:
            failures.append(f"No first_answer for: {q!r}")
        if len(session["exchanges"]) != len(templates["no_variants"]):
            failures.append("Exchange count mismatch")
        for no_line, follow_up in session["exchanges"]:
            if "{" in follow_up or "}" in follow_up:
                failures.append(f"Unfilled placeholder in follow-up: {follow_up!r}")
            if not no_line.strip():
                failures.append("Empty no_line")

        print(f"Q: {q}")
        print(f"  nouns found: {nouns}")
        print(f"  A: {answer}")
        print()

    # Check escalation intensity roughly increases (more caps / exclamation marks later on)
    no_variants = templates["no_variants"]
    intensities = [v.count("!") + sum(1 for c in v if c.isupper()) for v in no_variants]
    if intensities[-1] <= intensities[0]:
        failures.append("Escalation intensity does not increase from first to last 'No!' variant")

    if failures:
        print("FAILURES:")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)

    print("All offline checks passed.")


if __name__ == "__main__":
    main()
