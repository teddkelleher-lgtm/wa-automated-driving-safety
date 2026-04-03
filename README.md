# Washington Automated Driving Safety Counterfactual

Static site showing a Washington-focused counterfactual for traffic deaths and serious injuries under higher automated-driving adoption.

## Data

- County deaths: 2024 NHTSA FARS `accident.csv`
- Statewide serious injuries: Washington Traffic Safety Commission Brief No. 11 (October 2025)
- Safety effect assumption: Waymo Safety Impact page, 82% fewer injury-causing crashes versus the human benchmark

## Local preview

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`.
