"""Clinical / diagnostic test models — audiogram, speech, pre-test, impedance,
otoscopy, tuning fork, test session.

See `models/_canonical.py` for definitions. This is the largest domain — most
of the heavy clinical schemas live here. Grouped by sub-module to give devs a
faster scan path.
"""
from ._canonical import (
    # Audiogram
    AudiogramMeasurement,
    AudiogramData,
    # Speech audiometry
    SpeechTest,
    SpeechRow,
    SpeechWRSPoint,
    WordRecognitionRow,
    WordRecognitionInNoiseRow,
    SpeechAudiometryData,
    # Pre-test (case history / tuning fork / otoscopy)
    HearingSpecifics,
    TinnitusDetail,
    DizzinessDetail,
    NoiseExposure,
    FamilyHistory,
    MedicalHistoryDetail,
    HearingAidHistory,
    CommunicationNeeds,
    CaseHistory,
    TuningForkTest,
    EarOtoscopy,
    OtoscopyFinding,
    PreTestData,
    # Impedance / Tympanometry
    TympanogramEar,
    Tympanometry,
    ReflexCell,
    ReflexSide,
    ReflexEar,
    AcousticReflex,
    ReflexDecay,
    ETManeuver,
    ETEar,
    ETDysfunction,
    ETFIntactEar,
    ETFIntact,
    ImpedanceData,
    # Test session
    TestSession,
    TestSessionCreate,
    TestSessionUpdate,
)

__all__ = [
    "AudiogramMeasurement", "AudiogramData",
    "SpeechTest", "SpeechRow", "SpeechWRSPoint",
    "WordRecognitionRow", "WordRecognitionInNoiseRow", "SpeechAudiometryData",
    "HearingSpecifics", "TinnitusDetail", "DizzinessDetail", "NoiseExposure",
    "FamilyHistory", "MedicalHistoryDetail", "HearingAidHistory",
    "CommunicationNeeds", "CaseHistory", "TuningForkTest",
    "EarOtoscopy", "OtoscopyFinding", "PreTestData",
    "TympanogramEar", "Tympanometry",
    "ReflexCell", "ReflexSide", "ReflexEar", "AcousticReflex", "ReflexDecay",
    "ETManeuver", "ETEar", "ETDysfunction", "ETFIntactEar", "ETFIntact",
    "ImpedanceData",
    "TestSession", "TestSessionCreate", "TestSessionUpdate",
]
