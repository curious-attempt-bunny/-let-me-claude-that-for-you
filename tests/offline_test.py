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

        print(f"Q: {q}")
        print(f"  nouns found: {nouns}")
        print(f"  opening: {session['first_answer']}")
        print()

    # Every mini-conversation must render cleanly for every sample question,
    # with no leftover {placeholder} braces and no empty lines.
    num_conversations = len(templates["mini_conversations"])
    if num_conversations < 10:
        failures.append(f"Expected at least 10 mini_conversations, found {num_conversations}")

    for q in QUESTIONS:
        for i in range(num_conversations):
            convo = madlib.generate_mini_conversation(q, templates, conv_index=i)
            if not convo["turns"]:
                failures.append(f"Empty turns for conversation {i} on {q!r}")
            for turn in convo["turns"]:
                if turn["role"] not in ("human", "bot"):
                    failures.append(f"Unexpected role {turn['role']!r} in conversation {convo['id']}")
                if "{" in turn["text"] or "}" in turn["text"]:
                    failures.append(f"Unfilled placeholder in {convo['id']}: {turn['text']!r}")
                if not turn["text"].strip():
                    failures.append(f"Empty turn text in {convo['id']}")

    print(f"Rendered {num_conversations} mini-conversations x {len(QUESTIONS)} questions cleanly.")
    print()
    sample = madlib.generate_mini_conversation(QUESTIONS[0], templates, conv_index=0)
    print(f"Sample conversation ({sample['id']}):")
    for turn in sample["turns"]:
        print(f"  {turn['role']}: {turn['text']}")

    if failures:
        print("FAILURES:")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)

    print()
    print("All offline checks passed.")


if __name__ == "__main__":
    main()
