import sqlite3

from flask import jsonify


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def rows_to_list(rows) -> list:
    return [dict(r) for r in rows]


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status
