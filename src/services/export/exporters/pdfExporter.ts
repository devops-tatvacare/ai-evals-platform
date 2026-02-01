import { jsPDF } from 'jspdf';
import type { Exporter, ExportData } from '../types';

export const pdfExporter: Exporter = {
  id: 'pdf',
  name: 'PDF (Evaluation Report)',
  extension: 'pdf',
  mimeType: 'application/pdf',

  async export(data: ExportData): Promise<Blob> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;
    const leftMargin = 20;
    const lineHeight = 7;
    const sectionGap = 10;

    // Helper function to add text with wrapping
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, pageWidth - 2 * leftMargin);
      
      for (const line of lines) {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, leftMargin, y);
        y += lineHeight;
      }
    };

    const addSectionTitle = (title: string) => {
      y += sectionGap;
      addText(title, 14, true);
      y += 3;
    };

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Voice RX Evaluation Report', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Export info
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${data.exportedAt.toLocaleString()}`, pageWidth / 2, y, { align: 'center' });
    y += 20;

    // Listing Info
    addSectionTitle('Listing Information');
    addText(`Title: ${data.listing.title}`);
    addText(`Status: ${data.listing.status}`);
    addText(`Created: ${new Date(data.listing.createdAt).toLocaleString()}`);
    
    if (data.listing.audioFile) {
      addText(`Audio File: ${data.listing.audioFile.name}`);
      if (data.listing.audioFile.duration) {
        const minutes = Math.floor(data.listing.audioFile.duration / 60);
        const seconds = Math.floor(data.listing.audioFile.duration % 60);
        addText(`Duration: ${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    }

    // Transcript Summary
    if (data.listing.transcript) {
      addSectionTitle('Transcript Summary');
      addText(`Format Version: ${data.listing.transcript.formatVersion}`);
      addText(`Total Segments: ${data.listing.transcript.segments.length}`);
      
      const speakers = new Set(data.listing.transcript.segments.map(s => s.speaker));
      addText(`Speakers: ${Array.from(speakers).join(', ')}`);
      
      // Word count
      const wordCount = data.listing.transcript.segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
      addText(`Total Words: ${wordCount}`);
    }

    // AI Evaluation
    if (data.listing.aiEval) {
      addSectionTitle('AI Evaluation');
      addText(`Status: ${data.listing.aiEval.status}`);
      addText(`Model: ${data.listing.aiEval.model}`);
      addText(`Evaluated: ${new Date(data.listing.aiEval.createdAt).toLocaleString()}`);
      
      // Use critique statistics for metrics
      const stats = data.listing.aiEval.critique?.statistics;
      if (stats) {
        const matchPercentage = stats.totalSegments > 0 
          ? ((stats.matchCount / stats.totalSegments) * 100).toFixed(1)
          : '0';
        addText(`Match Percentage: ${matchPercentage}%`);
        addText(`Critical Issues: ${stats.criticalCount}`);
        addText(`Moderate Issues: ${stats.moderateCount}`);
        addText(`Minor Issues: ${stats.minorCount}`);
      }
      
      if (data.listing.aiEval.critique?.overallAssessment) {
        addText(`Assessment: ${data.listing.aiEval.critique.overallAssessment}`);
      }
    }

    // Human Evaluation
    if (data.listing.humanEval) {
      addSectionTitle('Human Evaluation');
      addText(`Status: ${data.listing.humanEval.status}`);
      if (data.listing.humanEval.overallScore) {
        addText(`Overall Score: ${data.listing.humanEval.overallScore}/5`);
      }
      addText(`Corrections Made: ${data.listing.humanEval.corrections.length}`);
      addText(`Last Updated: ${new Date(data.listing.humanEval.updatedAt).toLocaleString()}`);
      
      if (data.listing.humanEval.notes) {
        y += 5;
        addText('Notes:', 10, true);
        addText(data.listing.humanEval.notes);
      }

      // List corrections
      if (data.listing.humanEval.corrections.length > 0) {
        addSectionTitle('Corrections');
        data.listing.humanEval.corrections.forEach((correction, i) => {
          addText(`${i + 1}. Segment ${correction.segmentIndex + 1}:`, 10, true);
          addText(`   Original: "${correction.originalText.substring(0, 100)}${correction.originalText.length > 100 ? '...' : ''}"`);
          addText(`   Corrected: "${correction.correctedText.substring(0, 100)}${correction.correctedText.length > 100 ? '...' : ''}"`);
          if (correction.reason) {
            addText(`   Reason: ${correction.reason}`);
          }
          y += 3;
        });
      }
    }

    // Full Transcript (optional, at the end)
    if (data.listing.transcript && data.listing.transcript.segments.length <= 50) {
      addSectionTitle('Full Transcript');
      data.listing.transcript.segments.forEach((segment) => {
        addText(`[${segment.startTime}] ${segment.speaker}: ${segment.text}`);
      });
    } else if (data.listing.transcript) {
      addSectionTitle('Transcript (First 50 segments)');
      data.listing.transcript.segments.slice(0, 50).forEach((segment) => {
        addText(`[${segment.startTime}] ${segment.speaker}: ${segment.text}`);
      });
      addText(`... and ${data.listing.transcript.segments.length - 50} more segments`);
    }

    return doc.output('blob');
  },
};
