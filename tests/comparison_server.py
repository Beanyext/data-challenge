"""Additional saved runs for read-only comparison tests; synthetic data and mock only."""
from operations_server import app, saved

saved('synthetic-history', 1, 'synthetic-history-compare', {'c01': 'yes'})
