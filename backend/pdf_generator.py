from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas
from io import BytesIO
from datetime import datetime
import base64
from PIL import Image as PILImage

def _safe_dict(d, key):
    """Return d[key] if it is a dict, else {}. Handles the 'explicit-None' bug where .get(key, {}) returns None."""
    if not isinstance(d, dict):
        return {}
    v = d.get(key)
    return v if isinstance(v, dict) else {}


def _safe_list(d, key):
    if not isinstance(d, dict):
        return []
    v = d.get(key)
    return v if isinstance(v, list) else []


def create_audiogram_report(session_data, patient_data, audiogram_images=None):
    """
    Generate a professional audiological report PDF
    
    Args:
        session_data: Test session data including audiogram, speech, results
        patient_data: Patient demographic information
        audiogram_images: Dict with 'right' and 'left' base64 encoded images (optional)
    
    Returns:
        BytesIO buffer containing the PDF
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=1*inch,
        bottomMargin=0.75*inch
    )
    
    # Container for PDF elements
    elements = []
    
    # Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=colors.HexColor('#1a5490'),
        spaceAfter=12,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#2c5aa0'),
        spaceAfter=10,
        spaceBefore=15,
        fontName='Helvetica-Bold'
    )
    
    subheading_style = ParagraphStyle(
        'CustomSubheading',
        parent=styles['Heading3'],
        fontSize=11,
        textColor=colors.HexColor('#444444'),
        spaceAfter=8,
        fontName='Helvetica-Bold'
    )
    
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.black,
        spaceAfter=6,
        leading=14
    )
    
    # ==================== HEADER / LETTERHEAD ====================
    
    # Clinic Name
    clinic_name = Paragraph(
        "<b>ACS AUDIOLOGY CLINIC</b>",
        ParagraphStyle(
            'ClinicName',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=colors.HexColor('#1a5490'),
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
    )
    elements.append(clinic_name)
    
    # Clinic Contact Info
    clinic_info = Paragraph(
        "123 Hearing Street, Audiology City, AC 12345<br/>"
        "Phone: (555) 123-4567 | Email: info@acsaudiology.com<br/>"
        "RCI Registration: ACS-12345 | GSTIN: 27XXXXX1234X1ZX",
        ParagraphStyle(
            'ClinicInfo',
            parent=styles['Normal'],
            fontSize=9,
            textColor=colors.HexColor('#666666'),
            alignment=TA_CENTER,
            spaceAfter=15
        )
    )
    elements.append(clinic_info)
    
    # Horizontal line
    elements.append(Spacer(1, 0.1*inch))
    elements.append(Table(
        [['']], 
        colWidths=[7*inch],
        style=TableStyle([
            ('LINEABOVE', (0,0), (-1,-1), 2, colors.HexColor('#1a5490')),
        ])
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    # Report Title
    report_title = Paragraph("<b>AUDIOLOGICAL ASSESSMENT REPORT</b>", title_style)
    elements.append(report_title)
    elements.append(Spacer(1, 0.15*inch))
    
    # ==================== PATIENT INFORMATION ====================
    
    patient_heading = Paragraph("PATIENT INFORMATION", heading_style)
    elements.append(patient_heading)
    
    patient_table_data = [
        ['Patient Name:', patient_data.get('name', 'N/A'), 'MRD Number:', patient_data.get('patient_id', 'N/A')],
        ['Age:', f"{patient_data.get('age', 'N/A')} Years", 'Gender:', patient_data.get('gender', 'N/A')],
        ['Date of Birth:', patient_data.get('dob', 'N/A'), 'Phone:', patient_data.get('phone', 'N/A')],
        ['Test Date:', datetime.fromisoformat(session_data.get('test_date')).strftime('%d-%b-%Y %I:%M %p') if session_data.get('test_date') else 'N/A', 
         'Referring Physician:', patient_data.get('referring_physician', 'N/A')],
    ]
    
    patient_table = Table(patient_table_data, colWidths=[1.5*inch, 2*inch, 1.5*inch, 2*inch])
    patient_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f0f0f0')),
        ('BACKGROUND', (2,0), (2,-1), colors.HexColor('#f0f0f0')),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.black),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTNAME', (2,0), (2,-1), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(patient_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # ==================== TEST CONTEXT ====================
    
    test_context_heading = Paragraph("TEST CONTEXT", heading_style)
    elements.append(test_context_heading)
    
    test_context_data = [
        ['Test Reliability:', session_data.get('test_reliability', 'Good').capitalize()],
        ['Test Methods:', ', '.join(session_data.get('test_methods', ['Headphones']))],
        ['Audiologist:', session_data.get('audiologist_name', 'Not specified')],
    ]
    
    test_context_table = Table(test_context_data, colWidths=[2*inch, 5*inch])
    test_context_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f0f0f0')),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(test_context_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # ==================== PURE TONE AUDIOMETRY ====================
    
    pta_heading = Paragraph("PURE TONE AUDIOMETRY", heading_style)
    elements.append(pta_heading)
    
    # Audiogram images (if provided)
    if audiogram_images:
        audiogram_subheading = Paragraph("Audiograms", subheading_style)
        elements.append(audiogram_subheading)
        
        # Note: In production, you'd decode base64 images here
        # For now, we'll add a placeholder
        audiogram_note = Paragraph(
            "<i>Audiogram charts would be embedded here from the canvas images</i>",
            body_style
        )
        elements.append(audiogram_note)
        elements.append(Spacer(1, 0.1*inch))
    
    # PTA Results Table
    right_ear_data = _safe_dict(session_data, 'right_ear_audiogram')
    left_ear_data = _safe_dict(session_data, 'left_ear_audiogram')
    
    pta_table_data = [
        ['Measurement', 'Right Ear', 'Left Ear'],
        ['3-Frequency PTA', 
         f"{right_ear_data.get('pta_3freq', '--')} dB" if right_ear_data.get('pta_3freq') else '--',
         f"{left_ear_data.get('pta_3freq', '--')} dB" if left_ear_data.get('pta_3freq') else '--'],
        ['AC Thresholds', 
         f"{len(_safe_list(right_ear_data, 'ac_measurements'))} frequencies tested",
         f"{len(_safe_list(left_ear_data, 'ac_measurements'))} frequencies tested"],
        ['BC Thresholds',
         f"{len(_safe_list(right_ear_data, 'bc_measurements'))} frequencies tested",
         f"{len(_safe_list(left_ear_data, 'bc_measurements'))} frequencies tested"],
    ]
    
    pta_table = Table(pta_table_data, colWidths=[2.5*inch, 2.25*inch, 2.25*inch])
    pta_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a5490')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (-1,-1), 'CENTER'),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(pta_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # ==================== SPEECH AUDIOMETRY ====================
    
    speech_heading = Paragraph("SPEECH AUDIOMETRY", heading_style)
    elements.append(speech_heading)
    
    right_speech = _safe_dict(session_data, 'right_ear_speech')
    left_speech = _safe_dict(session_data, 'left_ear_speech')
    
    speech_table_data = [
        ['Test', 'Right Ear', 'Left Ear'],
        ['SRT (Speech Reception Threshold)',
         f"{right_speech.get('srt', '--')} dB" if right_speech.get('srt') else '--',
         f"{left_speech.get('srt', '--')} dB" if left_speech.get('srt') else '--'],
        ['WDS (Word Discrimination Score)',
         f"{right_speech.get('wds_percent', '--')}%" if right_speech.get('wds_percent') else '--',
         f"{left_speech.get('wds_percent', '--')}%" if left_speech.get('wds_percent') else '--'],
        ['MCL (Most Comfortable Level)',
         f"{right_speech.get('mcl', '--')} dB" if right_speech.get('mcl') else '--',
         f"{left_speech.get('mcl', '--')} dB" if left_speech.get('mcl') else '--'],
        ['UCL (Uncomfortable Level)',
         f"{right_speech.get('ucl', '--')} dB" if right_speech.get('ucl') else '--',
         f"{left_speech.get('ucl', '--')} dB" if left_speech.get('ucl') else '--'],
    ]
    
    speech_table = Table(speech_table_data, colWidths=[3*inch, 2*inch, 2*inch])
    speech_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a5490')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (-1,-1), 'CENTER'),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(speech_table)
    elements.append(Spacer(1, 0.2*inch))
    
    # ==================== RESULTS & INTERPRETATION ====================
    
    results_heading = Paragraph("RESULTS & INTERPRETATION", heading_style)
    elements.append(results_heading)
    
    # Right Ear Results
    right_results_heading = Paragraph("Right Ear", subheading_style)
    elements.append(right_results_heading)
    
    right_degree = session_data.get('right_ear_degree') or 'Not classified'
    right_type = session_data.get('right_ear_type') or 'Not classified'
    right_config = session_data.get('right_ear_config') or 'Not classified'
    
    right_results_text = f"<b>Degree:</b> {right_degree.replace('_', ' ').title()}<br/>"
    right_results_text += f"<b>Type:</b> {right_type.replace('_', ' ').title()}<br/>"
    right_results_text += f"<b>Configuration:</b> {right_config.replace('_', ' ').title()}"
    
    right_results_para = Paragraph(right_results_text, body_style)
    elements.append(right_results_para)
    elements.append(Spacer(1, 0.1*inch))
    
    # Left Ear Results
    left_results_heading = Paragraph("Left Ear", subheading_style)
    elements.append(left_results_heading)
    
    left_degree = session_data.get('left_ear_degree') or 'Not classified'
    left_type = session_data.get('left_ear_type') or 'Not classified'
    left_config = session_data.get('left_ear_config') or 'Not classified'
    
    left_results_text = f"<b>Degree:</b> {left_degree.replace('_', ' ').title()}<br/>"
    left_results_text += f"<b>Type:</b> {left_type.replace('_', ' ').title()}<br/>"
    left_results_text += f"<b>Configuration:</b> {left_config.replace('_', ' ').title()}"
    
    left_results_para = Paragraph(left_results_text, body_style)
    elements.append(left_results_para)
    elements.append(Spacer(1, 0.15*inch))
    
    # Clinical Impression
    if session_data.get('clinical_impression'):
        clinical_heading = Paragraph("Clinical Impression", subheading_style)
        elements.append(clinical_heading)
        
        clinical_text = session_data.get('clinical_impression', '')
        clinical_para = Paragraph(clinical_text, body_style)
        elements.append(clinical_para)
        elements.append(Spacer(1, 0.15*inch))
    
    # ==================== RECOMMENDATIONS ====================
    
    if session_data.get('recommendations') and len(session_data.get('recommendations')) > 0:
        rec_heading = Paragraph("RECOMMENDATIONS", heading_style)
        elements.append(rec_heading)
        
        rec_text = "<br/>".join([f"\u2022 {rec}" for rec in session_data.get('recommendations', [])])
        rec_para = Paragraph(rec_text, body_style)
        elements.append(rec_para)
        elements.append(Spacer(1, 0.2*inch))
    
    # ==================== SIGNATURE ====================
    
    elements.append(Spacer(1, 0.3*inch))
    
    signature_data = [
        ['', ''],
        ['_____________________', '_____________________'],
        [session_data.get('audiologist_name', 'Audiologist Name'), 'Date'],
        ['Audiologist', datetime.now().strftime('%d-%b-%Y')],
        [session_data.get('audiologist_license', 'License: RCI-XXXXX'), '']
    ]
    
    signature_table = Table(signature_data, colWidths=[3.5*inch, 3.5*inch])
    signature_table.setStyle(TableStyle([
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]))
    elements.append(signature_table)
    
    # Footer note
    elements.append(Spacer(1, 0.2*inch))
    footer_text = Paragraph(
        "<i>This is a computer-generated report. For any queries, please contact the clinic.</i>",
        ParagraphStyle(
            'Footer',
            parent=styles['Normal'],
            fontSize=8,
            textColor=colors.grey,
            alignment=TA_CENTER
        )
    )
    elements.append(footer_text)
    
    # Build PDF
    doc.build(elements)
    
    buffer.seek(0)
    return buffer


def generate_report_pdf(session_id, session_data, patient_data):
    """Wrapper function to generate PDF report"""
    try:
        pdf_buffer = create_audiogram_report(session_data, patient_data)
        return pdf_buffer
    except Exception as e:
        print(f"Error generating PDF: {str(e)}")
        raise
