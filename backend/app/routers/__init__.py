"""One module per area of the API, each exposing a single `router`.

Nothing is re-exported here: main.py imports the modules it needs and includes
them in a fixed order, so that order stays the one place route precedence is
decided.
"""
