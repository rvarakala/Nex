from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime
from uuid import uuid4

# ==================== PATIENT MODELS ====================

class Patient(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    patient_id: str = Field(default_factory=lambda: f"ACS-{datetime.now().year}-{str(uuid4())[:8].upper()}")
    name: str
    age: int
    gender: Literal["Male", "Female", "Other"]
    dob: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    referring_physician: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PatientCreate(BaseModel):
    name: str
    age: int
    gender: Literal["Male", "Female", "Other"]
    dob: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    referring_physician: Optional[str] = None


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


# ==================== PRE-TEST MODELS (Case History / Tuning Fork / Otoscopy) ====================

class CaseHistory(BaseModel):
    """Minimal case history intake"""
    chief_complaint: Optional[str] = None
    duration: Optional[str] = None  # e.g., "3 months"
    onset: Optional[Literal["sudden", "gradual", "unknown"]] = None
    affected_ear: Optional[Literal["right", "left", "both", "unknown"]] = None
    # Associated symptoms
    tinnitus: bool = False
    vertigo: bool = False
    otalgia: bool = False
    otorrhea: bool = False
    notes: Optional[str] = None


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
    
    # Pure Tone Audiometry
    right_ear_audiogram: Optional[AudiogramData] = None
    left_ear_audiogram: Optional[AudiogramData] = None
    
    # Speech Audiometry
    right_ear_speech: Optional[SpeechTest] = None
    left_ear_speech: Optional[SpeechTest] = None
    
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
    right_ear_audiogram: Optional[AudiogramData] = None
    left_ear_audiogram: Optional[AudiogramData] = None
    right_ear_speech: Optional[SpeechTest] = None
    left_ear_speech: Optional[SpeechTest] = None
    right_ear_degree: Optional[str] = None
    right_ear_type: Optional[str] = None
    right_ear_config: Optional[str] = None
    left_ear_degree: Optional[str] = None
    left_ear_type: Optional[str] = None
    left_ear_config: Optional[str] = None
    clinical_impression: Optional[str] = None
    recommendations: Optional[List[str]] = None
    status: Optional[Literal["draft", "completed", "finalized"]] = None
