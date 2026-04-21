from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Literal, Dict
from datetime import datetime
from uuid import uuid4


# ==================== MULTI-TENANT + AUTH MODELS ====================

class Clinic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    clinic_id: str
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    mrd_prefix: str = "ACS"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str = Field(default_factory=lambda: f"USR-{str(uuid4())[:10].upper()}")
    clinic_id: str
    email: str
    name: str
    role: Literal["super_admin", "front_desk", "audiologist", "accounts"]
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LoginRequest(BaseModel):
    email: str
    password: str


# ==================== TOKEN + QUEUE (UC-01 front-desk) ====================

class OPDToken(BaseModel):
    model_config = ConfigDict(extra="ignore")
    token_id: str = Field(default_factory=lambda: str(uuid4()))
    clinic_id: str
    token_no: int
    patient_id: str
    patient_name: str
    patient_mobile: Optional[str] = None
    mrd: Optional[str] = None
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    issued_by_user_id: Optional[str] = None
    status: Literal["waiting", "in_consultation", "in_testing", "billing", "completed", "cancelled"] = "waiting"
    called_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    service: Optional[str] = None
    priority: Literal["normal", "urgent", "vip"] = "normal"
    notes: Optional[str] = None


# ==================== UC-03 APPOINTMENTS ====================

APPOINTMENT_SERVICES = [
    "Consultation", "PTA", "Immittance", "OAE", "ABR/BERA", "ASSR",
    "Vestibular Tests", "Follow-up", "Speech Audiometry", "Hearing Aid Fitting",
]
APPOINTMENT_PRIORITIES = ["normal", "urgent", "vip"]
APPOINTMENT_STATUSES = ["scheduled", "confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled"]


class Appointment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    appointment_id: str = Field(default_factory=lambda: f"APT-{str(uuid4())[:10].upper()}")
    clinic_id: str

    patient_id: str
    patient_name: str                                 # Denormalised for fast list render
    patient_mobile: Optional[str] = None
    mrd: Optional[str] = None

    audiologist_id: str
    audiologist_name: str                             # Denormalised
    room: Optional[str] = None

    service: str
    priority: Literal["normal", "urgent", "vip"] = "normal"

    start_at: datetime                                # Full timestamp (UTC)
    end_at: datetime
    duration_minutes: int = 30

    status: Literal["scheduled", "confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled"] = "scheduled"

    notes: Optional[str] = None
    reminder_sent: bool = False

    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by_user_id: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AppointmentCreate(BaseModel):
    patient_id: str
    audiologist_id: str
    service: str
    start_at: datetime
    duration_minutes: int = 30
    priority: Literal["normal", "urgent", "vip"] = "normal"
    room: Optional[str] = None
    notes: Optional[str] = None


class WaitlistEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entry_id: str = Field(default_factory=lambda: f"WL-{str(uuid4())[:10].upper()}")
    clinic_id: str
    patient_id: str
    patient_name: str
    patient_mobile: Optional[str] = None
    mrd: Optional[str] = None
    preferred_audiologist_id: Optional[str] = None
    preferred_service: Optional[str] = None
    preferred_date: Optional[str] = None              # 'YYYY-MM-DD'
    notes: Optional[str] = None
    status: Literal["active", "scheduled", "cancelled"] = "active"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WaitlistCreate(BaseModel):
    patient_id: str
    preferred_audiologist_id: Optional[str] = None
    preferred_service: Optional[str] = None
    preferred_date: Optional[str] = None
    notes: Optional[str] = None


class CancellationLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    log_id: str = Field(default_factory=lambda: f"CAN-{str(uuid4())[:10].upper()}")
    clinic_id: str
    appointment_id: str
    patient_id: str
    patient_name: str
    cancelled_at: datetime = Field(default_factory=datetime.utcnow)
    cancelled_by_user_id: str
    reason: Optional[str] = None
    was_same_day: bool = False


class ReminderLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reminder_id: str = Field(default_factory=lambda: f"REM-{str(uuid4())[:10].upper()}")
    clinic_id: str
    appointment_id: Optional[str] = None
    patient_id: str
    channel: Literal["whatsapp", "sms", "email"]
    recipient: str                                    # Phone or email used
    subject: Optional[str] = None
    body: str
    status: Literal["pending", "sent", "failed", "stubbed_no_provider_key"] = "pending"
    provider_response: Optional[str] = None
    sent_at: datetime = Field(default_factory=datetime.utcnow)
    sent_by_user_id: Optional[str] = None


# ==================== PATIENT MODELS ====================

class Patient(BaseModel):
    model_config = ConfigDict(extra="ignore")

    patient_id: str = Field(default_factory=lambda: f"ACS-{datetime.now().year}-{str(uuid4())[:8].upper()}")
    clinic_id: str                                      # Tenant scope
    mrd: Optional[str] = None                           # Human-facing Medical Record Document number

    # Demographics
    name: str
    age: int
    gender: Literal["Male", "Female", "Other"]
    dob: Optional[str] = None
    occupation: Optional[str] = None

    # Contact
    mobile: Optional[str] = None
    alternate_mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None

    # Identity
    aadhaar_last4: Optional[str] = None

    # Clinical triage at registration (one-liner — full case history lives in M02 Pre-Test)
    chief_complaint: Optional[str] = None
    complaint_duration: Optional[str] = None
    ear_side: Optional[Literal["Left", "Right", "Bilateral"]] = None

    # Referral + insurance
    referring_physician: Optional[str] = None           # Free-text fallback
    referring_doctor_id: Optional[str] = None           # FK into referring_doctors
    referral_source: Optional[str] = None               # Walk-in / Doctor / Online / Camp / Family / Other

    insurance_scheme: Optional[str] = None              # Cash / CGHS / ECHS / ESIC / Ayushman / Private / Other
    insurance_card_number: Optional[str] = None
    insurance_validity: Optional[str] = None
    insurance_beneficiary: Optional[str] = None         # e.g. "Self", "Spouse", "Dependant"

    notes: Optional[str] = None
    phone: Optional[str] = None  # Legacy compatibility

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PatientCreate(BaseModel):
    name: str
    age: int
    gender: Literal["Male", "Female", "Other"]
    dob: Optional[str] = None
    occupation: Optional[str] = None

    mobile: Optional[str] = None
    alternate_mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None

    aadhaar_last4: Optional[str] = None

    chief_complaint: Optional[str] = None
    complaint_duration: Optional[str] = None
    ear_side: Optional[Literal["Left", "Right", "Bilateral"]] = None

    referring_physician: Optional[str] = None
    referring_doctor_id: Optional[str] = None
    referral_source: Optional[str] = None

    insurance_scheme: Optional[str] = None
    insurance_card_number: Optional[str] = None
    insurance_validity: Optional[str] = None
    insurance_beneficiary: Optional[str] = None

    notes: Optional[str] = None
    phone: Optional[str] = None  # Legacy


# ==================== REFERRING DOCTOR MODELS ====================

class ReferringDoctor(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doctor_id: str = Field(default_factory=lambda: f"DR-{str(uuid4())[:8].upper()}")
    clinic_id: Optional[str] = None                # Populated by server from auth
    name: str
    specialty: Optional[str] = None        # e.g., ENT, GP, Paediatrics, Neurology
    clinic: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ReferringDoctorCreate(BaseModel):
    name: str
    specialty: Optional[str] = None
    clinic: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


# ==================== PATIENT JOURNAL / CHART NOTES ====================

class PatientNote(BaseModel):
    model_config = ConfigDict(extra="ignore")

    note_id: str = Field(default_factory=lambda: f"NOTE-{str(uuid4())[:10].upper()}")
    patient_id: str
    audiologist: Optional[str] = None
    text: str
    auto: bool = False                     # True for system-generated entries (session created, report printed, etc.)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PatientNoteCreate(BaseModel):
    patient_id: str
    text: str
    audiologist: Optional[str] = None
    auto: bool = False


# ==================== AUDIOGRAM MODELS ====================

class AudiogramMeasurement(BaseModel):
    """Single threshold measurement"""
    frequency: int  # Hz (250, 500, 1000, etc.)
    threshold_db: Optional[int] = None  # dB HL
    masked: bool = False
    no_response: bool = False

class AudiogramData(BaseModel):
    """Complete audiogram for one ear"""
    ear: Literal["right", "left"]
    ac_measurements: List[AudiogramMeasurement] = []  # Air Conduction
    bc_measurements: List[AudiogramMeasurement] = []  # Bone Conduction
    pta_3freq: Optional[float] = None  # Average of 500, 1K, 2K
    pta_4freq: Optional[float] = None  # Average of 500, 1K, 2K, 4K


# ==================== SPEECH AUDIOMETRY MODELS ====================

class SpeechTest(BaseModel):
    """Speech audiometry results for one ear"""
    ear: Literal["right", "left"]
    srt: Optional[int] = None  # Speech Reception Threshold (dB)
    srt_masked: bool = False
    wds_percent: Optional[int] = None  # Word Discrimination Score (%)
    wds_presentation_level: Optional[int] = None  # dB
    wds_masked: bool = False
    sat: Optional[int] = None  # Speech Awareness Threshold
    mcl: Optional[int] = None  # Most Comfortable Level
    ucl: Optional[int] = None  # Uncomfortable Loudness Level


class SpeechRow(BaseModel):
    """Single row of the Speech Audiometry grid (Right / Left / Soundfield / Soundfield Aided).
    All values are free-form strings so clinicians can enter numbers ("55") or
    markers ("NR", "CNT") interchangeably.
    """
    sat: Optional[str] = None
    srt: Optional[str] = None
    masking: Optional[str] = None
    mcl: Optional[str] = None
    ucl: Optional[str] = None


class SpeechWRSPoint(BaseModel):
    """Single plotted point on the Speech Audiogram (WRS curve)."""
    db_hl: float
    percent: float
    masked: bool = False


class WordRecognitionRow(BaseModel):
    """Row of the Word Recognition table — unaided (Word List) + aided (Presentation) pair."""
    db_hl_unaided: Optional[str] = None
    percent_unaided: Optional[str] = None
    masking_unaided: Optional[str] = None
    db_hl_aided: Optional[str] = None
    percent_aided: Optional[str] = None
    masking_aided: Optional[str] = None


class WordRecognitionInNoiseRow(BaseModel):
    """Row of the Word Recognition in Noise table."""
    db_hl: Optional[str] = None
    percent: Optional[str] = None
    noise_level: Optional[str] = None


class SpeechAudiometryData(BaseModel):
    """Speech Audiometry dataset.
    - WRS curves per channel (audiogram plotting points)
    - `fields` is a flat key→string map for every SRT/SAT/WR/WRN/MCL/UCL/QSIN entry,
      keeping the model schema-free so we can iterate on the form layout without migrations.
    """
    wrs_right: List[SpeechWRSPoint] = []
    wrs_left: List[SpeechWRSPoint] = []
    wrs_soundfield: List[SpeechWRSPoint] = []
    wrs_soundfield_aided: List[SpeechWRSPoint] = []
    fields: Dict[str, str] = Field(default_factory=dict)


# ==================== PRE-TEST MODELS (Case History / Tuning Fork / Otoscopy) ====================

class HearingSpecifics(BaseModel):
    suspect_hearing_loss: Optional[Literal["yes", "no", "not_sure"]] = None
    better_ear: Optional[Literal["right", "left", "same"]] = None
    progression: Optional[Literal["fluctuating", "gradual", "rapid", "sudden"]] = None
    prior_test: bool = False
    prior_test_details: Optional[str] = None
    seen_physician: bool = False
    physician_details: Optional[str] = None
    earache_drainage_3mo: bool = False
    aural_fullness: bool = False
    aural_fullness_ear: Optional[Literal["right", "left", "both"]] = None
    aural_fullness_frequency: Optional[str] = None


class TinnitusDetail(BaseModel):
    ear: Optional[Literal["right", "left", "both"]] = None
    frequency: Optional[Literal["constant", "intermittent", "occasional"]] = None
    bothersome: Optional[Literal["yes", "no", "sometimes"]] = None
    sound_description: Optional[str] = None


class DizzinessDetail(BaseModel):
    dizzy_today: bool = False
    associated_symptoms: List[str] = []  # nausea/tinnitus/hearing_loss/vision/other
    frequency: Optional[str] = None
    falls_12mo: bool = False
    falls_count: Optional[int] = None
    falls_injured: bool = False
    falls_injury_details: Optional[str] = None


class NoiseExposure(BaseModel):
    exposed: bool = False
    description: Optional[str] = None


class FamilyHistory(BaseModel):
    hearing_loss_in_family: Optional[Literal["yes", "no", "not_sure"]] = None
    description: Optional[str] = None


class MedicalHistoryDetail(BaseModel):
    prior_head_neck_surgery: bool = False
    prior_head_neck_surgery_details: Optional[str] = None
    head_trauma: bool = False
    head_trauma_details: Optional[str] = None
    medications: Optional[str] = None
    conditions: List[str] = []  # diabetes, hypertension, stroke_tia, etc.


class HearingAidHistory(BaseModel):
    ever_used: bool = False
    currently_using: bool = False
    ear: Optional[Literal["right", "left", "both"]] = None
    years_of_use: Optional[str] = None
    regular_wear: Optional[bool] = None
    benefit: Optional[bool] = None
    problems: Optional[str] = None


class CommunicationNeeds(BaseModel):
    difficult_situations: List[str] = []  # tv/phone/restaurant/meeting/theatre/worship
    top_problem_areas: List[str] = []  # up to 3 free-text items
    phone_ear: Optional[Literal["right", "left", "switch"]] = None


# ==================== IMPEDANCE / TYMPANOMETRY MODELS ====================

class TympanogramEar(BaseModel):
    jerger_type: Optional[Literal["A", "As", "Ad", "B", "C"]] = None
    me_pressure: Optional[float] = None   # daPa
    compliance: Optional[float] = None    # mL
    volume: Optional[float] = None        # cc (ECV — reported value only, not used in curve plotting)
    probe_hz: Literal[226, 678, 800, 1000] = 226
    notes: Optional[str] = None


class Tympanometry(BaseModel):
    right: TympanogramEar = Field(default_factory=TympanogramEar)
    left: TympanogramEar = Field(default_factory=TympanogramEar)


class ReflexCell(BaseModel):
    level: Optional[str] = None     # free-form: numbers ("85"), alphabetic markers ("NR", "CNT"), or any combination
    volume: Optional[float] = None  # legacy — kept for backward compatibility, no longer displayed
    pressure: Optional[float] = None  # legacy — kept for backward compatibility, no longer displayed


class ReflexSide(BaseModel):
    freqs: Dict[str, ReflexCell] = Field(default_factory=dict)


class ReflexEar(BaseModel):
    ipsi: ReflexSide = Field(default_factory=ReflexSide)
    contra: ReflexSide = Field(default_factory=ReflexSide)


class AcousticReflex(BaseModel):
    enabled: bool = False
    right: ReflexEar = Field(default_factory=ReflexEar)
    left: ReflexEar = Field(default_factory=ReflexEar)


class ReflexDecay(BaseModel):
    enabled: bool = False
    right: ReflexEar = Field(default_factory=ReflexEar)
    left: ReflexEar = Field(default_factory=ReflexEar)


class ETManeuver(BaseModel):
    pressure_before: Optional[float] = None
    pressure_after: Optional[float] = None
    interpretation: Optional[Literal["positive", "negative", "equivocal"]] = None
    notes: Optional[str] = None


class ETEar(BaseModel):
    toynbee: ETManeuver = Field(default_factory=ETManeuver)
    valsalva: ETManeuver = Field(default_factory=ETManeuver)
    pressure_app: ETManeuver = Field(default_factory=ETManeuver)


class ETDysfunction(BaseModel):
    enabled: bool = False
    right: ETEar = Field(default_factory=ETEar)
    left: ETEar = Field(default_factory=ETEar)


class ETFIntactEar(BaseModel):
    """Williams ETF-Intact TM test — 3 sequential tympanograms produce 3 peak pressures.
    P1 = baseline · P2 = after Valsalva (positive swing) · P3 = after Toynbee (negative swing).
    ETF is considered intact if consecutive peaks shift by ≥15-30 daPa.
    """
    volume: Optional[float] = None         # mL (ECV — single value for the ear)
    pressure_1: Optional[float] = None     # daPa — baseline peak
    pressure_2: Optional[float] = None     # daPa — post-Valsalva peak
    pressure_3: Optional[float] = None     # daPa — post-Toynbee peak
    notes: Optional[str] = None


class ETFIntact(BaseModel):
    enabled: bool = False
    right: ETFIntactEar = Field(default_factory=ETFIntactEar)
    left: ETFIntactEar = Field(default_factory=ETFIntactEar)


class ImpedanceData(BaseModel):
    tympanometry: Tympanometry = Field(default_factory=Tympanometry)
    acoustic_reflex: AcousticReflex = Field(default_factory=AcousticReflex)
    reflex_decay: ReflexDecay = Field(default_factory=ReflexDecay)
    et_dysfunction: ETDysfunction = Field(default_factory=ETDysfunction)
    etf_intact: ETFIntact = Field(default_factory=ETFIntact)



class CaseHistory(BaseModel):
    """Expanded adult audiology case history"""
    # Core (minimal — always visible)
    chief_complaint: Optional[str] = None
    duration: Optional[str] = None  # e.g., "3 months"
    onset: Optional[Literal["sudden", "gradual", "unknown"]] = None
    affected_ear: Optional[Literal["right", "left", "both", "unknown"]] = None
    # Associated symptom flags (quick checkboxes)
    tinnitus: bool = False
    vertigo: bool = False
    otalgia: bool = False
    otorrhea: bool = False
    notes: Optional[str] = None

    # Extended sections (accordion)
    hearing_specifics: HearingSpecifics = Field(default_factory=HearingSpecifics)
    tinnitus_detail: TinnitusDetail = Field(default_factory=TinnitusDetail)
    dizziness_detail: DizzinessDetail = Field(default_factory=DizzinessDetail)
    noise_exposure: NoiseExposure = Field(default_factory=NoiseExposure)
    family_history: FamilyHistory = Field(default_factory=FamilyHistory)
    medical_history: MedicalHistoryDetail = Field(default_factory=MedicalHistoryDetail)
    hearing_aid_history: HearingAidHistory = Field(default_factory=HearingAidHistory)
    communication_needs: CommunicationNeeds = Field(default_factory=CommunicationNeeds)


class TuningForkTest(BaseModel):
    """Standard tuning-fork battery"""
    frequency_hz: Literal[256, 512, 1024, 2048] = 512
    # Rinne (AC vs BC) per ear
    rinne_right: Optional[Literal["positive", "negative", "equal"]] = None
    rinne_left: Optional[Literal["positive", "negative", "equal"]] = None
    rinne_notes: Optional[str] = None
    # Weber — where sound lateralizes
    weber: Optional[Literal["right", "left", "midline", "not_lateralized"]] = None
    weber_notes: Optional[str] = None
    # Absolute Bone Conduction per ear
    abc_right: Optional[Literal["normal", "reduced"]] = None
    abc_left: Optional[Literal["normal", "reduced"]] = None
    abc_notes: Optional[str] = None
    # Bing (occlusion effect) per ear
    bing_right: Optional[Literal["positive", "negative"]] = None
    bing_left: Optional[Literal["positive", "negative"]] = None
    bing_notes: Optional[str] = None


class EarOtoscopy(BaseModel):
    """Otoscopic findings for a single ear"""
    pinna: Optional[Literal["normal", "abnormal"]] = None
    eac: Optional[Literal["clear", "wax", "debris", "inflamed", "foreign_body", "other"]] = None
    tm: Optional[Literal[
        "intact_normal", "retracted", "bulging", "perforated",
        "dull", "erythematous", "effusion", "scarred", "other"
    ]] = None
    notes: Optional[str] = None
    image_base64: Optional[str] = None  # client-side resized (<= 800px), data-URI


class OtoscopyFinding(BaseModel):
    right: EarOtoscopy = Field(default_factory=EarOtoscopy)
    left: EarOtoscopy = Field(default_factory=EarOtoscopy)


class PreTestData(BaseModel):
    """Combined pre-test intake (case history + tuning fork + otoscopy)"""
    case_history: CaseHistory = Field(default_factory=CaseHistory)
    tuning_fork: TuningForkTest = Field(default_factory=TuningForkTest)
    otoscopy: OtoscopyFinding = Field(default_factory=OtoscopyFinding)


# ==================== TEST SESSION MODELS ====================

class TestSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    session_id: str = Field(default_factory=lambda: f"SES-{str(uuid4())[:12].upper()}")
    patient_id: str
    test_date: datetime = Field(default_factory=datetime.utcnow)
    audiologist_name: Optional[str] = None
    audiologist_license: Optional[str] = None
    
    # Test Context
    test_reliability: Literal["good", "fair", "poor"] = "good"
    test_methods: List[str] = ["headphones"]  # headphones, inserts, sound_field, bone_vibrator
    
    # History/Symptoms
    symptoms: List[str] = []
    chief_complaint: Optional[str] = None
    history_notes: Optional[str] = None
    
    # Pre-Test (Case History + Tuning Fork + Otoscopy)
    pre_test_data: Optional[PreTestData] = None
    
    # Impedance / Tympanometry
    impedance_data: Optional[ImpedanceData] = None
    
    # Pure Tone Audiometry
    right_ear_audiogram: Optional[AudiogramData] = None
    left_ear_audiogram: Optional[AudiogramData] = None
    
    # Speech Audiometry
    right_ear_speech: Optional[SpeechTest] = None
    left_ear_speech: Optional[SpeechTest] = None
    speech_data: Optional[SpeechAudiometryData] = None

    # P2 clinical tabs — schema-free (evolves without migrations)
    special_tests_data: Optional[Dict[str, Dict[str, str]]] = None
    oae_data: Optional[Dict[str, Dict[str, str]]] = None
    soundfield_data: Optional[Dict[str, Dict[str, str]]] = None
    abr_data: Optional[Dict[str, Dict[str, str]]] = None
    pediatric_data: Optional[Dict[str, Dict[str, str]]] = None
    tinnitus_data: Optional[Dict[str, Dict[str, str]]] = None

    # Results Interpretation
    right_ear_degree: Optional[Literal["normal", "slight", "mild", "moderate", "moderately_severe", "severe", "profound"]] = None
    right_ear_type: Optional[Literal["normal", "conductive", "sensorineural", "mixed"]] = None
    right_ear_config: Optional[Literal["flat", "sloping", "rising", "notch", "u_shape", "high_freq", "low_freq"]] = None
    
    left_ear_degree: Optional[Literal["normal", "slight", "mild", "moderate", "moderately_severe", "severe", "profound"]] = None
    left_ear_type: Optional[Literal["normal", "conductive", "sensorineural", "mixed"]] = None
    left_ear_config: Optional[Literal["flat", "sloping", "rising", "notch", "u_shape", "high_freq", "low_freq"]] = None
    
    # Clinical Notes
    clinical_impression: Optional[str] = None
    recommendations: List[str] = []
    
    # Metadata
    status: Literal["draft", "completed", "finalized"] = "draft"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TestSessionCreate(BaseModel):
    patient_id: str
    audiologist_name: Optional[str] = None
    audiologist_license: Optional[str] = None
    test_reliability: Literal["good", "fair", "poor"] = "good"
    test_methods: List[str] = ["headphones"]
    symptoms: List[str] = []
    chief_complaint: Optional[str] = None


class TestSessionUpdate(BaseModel):
    test_reliability: Optional[Literal["good", "fair", "poor"]] = None
    test_methods: Optional[List[str]] = None
    symptoms: Optional[List[str]] = None
    chief_complaint: Optional[str] = None
    history_notes: Optional[str] = None
    pre_test_data: Optional[PreTestData] = None
    impedance_data: Optional[ImpedanceData] = None
    right_ear_audiogram: Optional[AudiogramData] = None
    left_ear_audiogram: Optional[AudiogramData] = None
    right_ear_speech: Optional[SpeechTest] = None
    left_ear_speech: Optional[SpeechTest] = None
    speech_data: Optional[SpeechAudiometryData] = None
    special_tests_data: Optional[Dict[str, Dict[str, str]]] = None
    oae_data: Optional[Dict[str, Dict[str, str]]] = None
    soundfield_data: Optional[Dict[str, Dict[str, str]]] = None
    abr_data: Optional[Dict[str, Dict[str, str]]] = None
    pediatric_data: Optional[Dict[str, Dict[str, str]]] = None
    tinnitus_data: Optional[Dict[str, Dict[str, str]]] = None
    right_ear_degree: Optional[str] = None
    right_ear_type: Optional[str] = None
    right_ear_config: Optional[str] = None
    left_ear_degree: Optional[str] = None
    left_ear_type: Optional[str] = None
    left_ear_config: Optional[str] = None
    clinical_impression: Optional[str] = None
    puretone_findings: Optional[str] = None
    immitence_findings: Optional[str] = None
    speech_findings: Optional[str] = None
    provisional_diagnosis: Optional[str] = None
    further_advice: Optional[str] = None
    referred_by: Optional[str] = None
    recommendations: Optional[List[str]] = None
    status: Optional[Literal["draft", "completed", "finalized"]] = None
