#!/bin/bash
# Двойной щелчок по этому файлу открывает окно трекера.
cd "$(dirname "$0")"
/usr/bin/python3 app.py || python3 app.py
