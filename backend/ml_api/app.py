from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import json
import os
import warnings
warnings.filterwarnings('ignore')

app  = Flask(__name__)
CORS(app)

# ── Load saved models ─────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, 'arv_model_output')

print('Loading XGBoost model...')
model  = joblib.load(os.path.join(MODEL_DIR, 'xgboost_model.pkl'))
scaler = joblib.load(os.path.join(MODEL_DIR, 'scaler.pkl'))

with open(os.path.join(MODEL_DIR, 'model_config.json')) as f:
    config = json.load(f)

FEATURES  = config['features']
THRESHOLD = config['threshold']
DEFAULTS  = config.get('defaults', {})
print(f'XGBoost model loaded! Features: {len(FEATURES)} | Threshold: {THRESHOLD:.2f}')


# ── Build feature vector from patient dict ────────────────────────
def build_feature_vector(patient: dict) -> list:
    """
    Maps patient dict → ordered feature list matching FEATURES from training.
    Uses clinically plausible defaults for missing values.
    """
    def get(key, fallback):
        val = patient.get(key, DEFAULTS.get(key, fallback))
        return float(val) if val is not None else float(fallback)

    # Demographics
    age            = get('age', 30)
    gender_m       = int(str(patient.get('gender', 'F')).upper() == 'M')
    has_supporter  = int(patient.get('treatment_supporter', 1))
    tb_flag        = int(patient.get('tb_coinfection', 0))
    pregnancy_flag = int(patient.get('pregnancy_status', 0))

    ms_map = {'single': 0, 'divorced': 1, 'cohabiting': 2, 'married': 3, 'widowed': 4}
    marital_enc = ms_map.get(str(patient.get('marital_status', 'Married')).lower(), 2)

    fn_map = {'bedridden': 0, 'ambulatory': 1, 'working': 2}
    functional_enc = fn_map.get(str(patient.get('functional_status', 'Working')).lower(), 1)

    ch_map = {'none': 0, 'asthma': 1, 'anaemia': 1, 'diabetes': 1, 'hypertension': 1,
              'tuberculosis': 2, 'hepatitis b': 2, 'renal disease': 3}
    chronic_score = ch_map.get(str(patient.get('chronic_conditions', 'None')).lower(), 0)

    who_clinical_stage = get('who_clinical_stage', 2)
    months_on_art      = get('months_on_art', 24)

    # Appointment behaviour
    avg_days_late    = get('avg_days_late', 7)
    pct_very_late    = get('pct_very_late', 0.28)
    missed_rate      = get('missed_rate', 0.07)
    regimen_changes  = get('regimen_changes', 0)
    side_effect_rate = get('side_effect_rate', 0.10)
    counselling_rate = get('counselling_rate', 0.87)

    # Lab values
    latest_cd4          = get('latest_cd4', 300)
    first_cd4           = get('first_cd4', 300)
    cd4_improvement     = get('cd4_improvement', 0)
    vl_sup_rate         = get('vl_sup_rate', 0.75)
    latest_vl_suppressed= get('latest_vl_suppressed', 1)

    # Anthropometry
    latest_weight = get('latest_weight', 60)
    latest_bmi    = get('latest_bmi', 21)
    best_hb       = get('best_hb', 12)

    # Pharmacy
    mmd_rate          = get('mmd_rate', 0.30)
    avg_days_supply   = get('avg_days_supply', 50)
    stock_out_rate    = get('stock_out_rate', 0)
    pharm_reg_changes = get('pharm_reg_changes', 0)

    feat = {
        'age'                : age,
        'gender_m'           : gender_m,
        'has_supporter'      : has_supporter,
        'tb_flag'            : tb_flag,
        'pregnancy_flag'     : pregnancy_flag,
        'marital_enc'        : marital_enc,
        'functional_enc'     : functional_enc,
        'chronic_score'      : chronic_score,
        'who_clinical_stage' : who_clinical_stage,
        'months_on_art'      : months_on_art,
        'avg_days_late'      : avg_days_late,
        'pct_very_late'      : pct_very_late,
        'missed_rate'        : missed_rate,
        'regimen_changes'    : regimen_changes,
        'side_effect_rate'   : side_effect_rate,
        'counselling_rate'   : counselling_rate,
        'latest_cd4'         : latest_cd4,
        'first_cd4'          : first_cd4,
        'cd4_improvement'    : cd4_improvement,
        'vl_sup_rate'        : vl_sup_rate,
        'latest_vl_suppressed': latest_vl_suppressed,
        'latest_weight'      : latest_weight,
        'latest_bmi'         : latest_bmi,
        'best_hb'            : best_hb,
        'mmd_rate'           : mmd_rate,
        'avg_days_supply'    : avg_days_supply,
        'stock_out_rate'     : stock_out_rate,
        'pharm_reg_changes'  : pharm_reg_changes,
    }

    return [feat[f] for f in FEATURES]


# ── Risk label ────────────────────────────────────────────────────
def get_label(score: int) -> str:
    if score >= 75: return 'High'
    if score >= 40: return 'Medium'
    return 'Low'


# ── Build human-readable risk factors ────────────────────────────
def build_factors(patient: dict, prob: float) -> list:
    factors = []

    missed_rate   = float(patient.get('missed_rate', 0.07))
    pct_very_late = float(patient.get('pct_very_late', 0.28))
    avg_days_late = float(patient.get('avg_days_late', 7))
    cd4_imp       = float(patient.get('cd4_improvement', 0))
    vl_sup        = float(patient.get('vl_sup_rate', 0.75))
    mmd_rate      = float(patient.get('mmd_rate', 0.30))
    supporter     = int(patient.get('treatment_supporter', 1))
    months_art    = float(patient.get('months_on_art', 24))

    # Risk increasing
    if missed_rate > 0.20:
        factors.append(f'↑ High missed appointment rate ({missed_rate:.0%})')
    if pct_very_late > 0.30:
        factors.append(f'↑ Frequently very late to appointments ({pct_very_late:.0%})')
    if avg_days_late > 14:
        factors.append(f'↑ Average {avg_days_late:.0f} days late per visit')
    if cd4_imp < -50:
        factors.append(f'↑ Declining CD4 count (Δ{cd4_imp:.0f})')
    if vl_sup < 0.50:
        factors.append(f'↑ Poor viral load suppression ({vl_sup:.0%})')
    if not supporter:
        factors.append('↑ No treatment supporter assigned')

    # Risk reducing
    if mmd_rate > 0.50:
        factors.append(f'↓ On multi-month dispensing ({mmd_rate:.0%})')
    if supporter:
        factors.append('↓ Has treatment supporter')
    if months_art > 24:
        factors.append(f'↓ Established on ART ({months_art/12:.1f} years)')
    if vl_sup > 0.80:
        factors.append(f'↓ Good viral suppression ({vl_sup:.0%})')

    return factors[:6] or ['Insufficient data to determine specific factors']


# ── /predict endpoint ─────────────────────────────────────────────
@app.route('/predict', methods=['POST'])
def predict():
    try:
        patient = request.get_json()
        if not patient:
            return jsonify({'error': 'No patient data provided'}), 400

        X_raw = build_feature_vector(patient)
        prob  = model.predict_proba([X_raw])[0][1]
        score = round(float(prob) * 100)
        label = get_label(score)
        factors = build_factors(patient, prob)

        return jsonify({
            'score'      : score,
            'label'      : label,
            'factors'    : factors,
            'probability': round(float(prob), 4),
            'prediction' : int(prob >= THRESHOLD),
            'model'      : f'XGBoost v{config.get("model_version", "2.0.0")}',
            'threshold'  : THRESHOLD
        })

    except Exception as e:
        import traceback
        print(f'PREDICT ERROR: {traceback.format_exc()}')
        return jsonify({'error': str(e)}), 500


# ── /batch endpoint ───────────────────────────────────────────────
@app.route('/batch', methods=['POST'])
def batch_predict():
    try:
        data     = request.get_json()
        patients = data.get('patients', [])
        if not patients:
            return jsonify({'error': 'No patients provided'}), 400

        results = []
        for patient in patients:
            X_raw = build_feature_vector(patient)
            prob  = model.predict_proba([X_raw])[0][1]
            score = round(float(prob) * 100)
            results.append({
                'patient_id' : patient.get('patient_id', 'unknown'),
                'score'      : score,
                'label'      : get_label(score),
                'probability': round(float(prob), 4),
                'prediction' : int(prob >= THRESHOLD)
            })

        return jsonify({'predictions': results, 'count': len(results)})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── /health endpoint ──────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status'   : 'ok',
        'model'    : f'XGBoost v{config.get("model_version", "2.0.0")}',
        'auc'      : config.get('auc', 0.886),
        'dataset'  : config.get('dataset', 'Chipinge ART Cohort'),
        'features' : len(FEATURES),
        'threshold': THRESHOLD
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f'ARV ML API (XGBoost) running on port {port}')
    app.run(host='0.0.0.0', port=port, debug=False)