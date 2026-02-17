import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Exporter, ExportData } from '../types';
import type { SegmentCritique, TranscriptCorrection } from '@/types';

export const pdfExporter: Exporter = {
  id: 'pdf',
  name: 'PDF (Evaluation Report)',
  extension: 'pdf',
  mimeType: 'application/pdf',

  async export(data: ExportData): Promise<Blob> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let currentPage = 1;

    // Helper to add page footer
    const addFooter = () => {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Page ${currentPage}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
      doc.text(
        `Generated: ${data.exportedAt.toLocaleString()}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: 'right' }
      );
      doc.setTextColor(0, 0, 0);
    };

    // Helper to add new page with footer
    const addNewPage = () => {
      addFooter();
      doc.addPage();
      currentPage++;
    };

    // Helper to draw section divider
    const drawDivider = (y: number) => {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
    };

    // ============ COVER / HEADER SECTION ============
    let y = 40;

    // Title
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(44, 62, 80);
    doc.text('Voice RX Evaluation Report', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Listing title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(52, 73, 94);
    doc.text(data.listing.title, pageWidth / 2, y, { align: 'center' });
    y += 25;

    drawDivider(y);
    y += 15;

    // ============ EXECUTIVE SUMMARY ============
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Executive Summary', margin, y);
    y += 10;

    // Build summary data
    const summaryData: string[][] = [];
    
    summaryData.push(['Status', data.listing.status.toUpperCase()]);
    summaryData.push(['Created', new Date(data.listing.createdAt).toLocaleString()]);
    
    if (data.listing.audioFile) {
      summaryData.push(['Audio File', data.listing.audioFile.name]);
      if (data.listing.audioFile.duration) {
        const mins = Math.floor(data.listing.audioFile.duration / 60);
        const secs = Math.floor(data.listing.audioFile.duration % 60);
        summaryData.push(['Duration', `${mins}:${secs.toString().padStart(2, '0')}`]);
      }
    }

    if (data.listing.transcript) {
      summaryData.push(['Total Segments', String(data.listing.transcript.segments.length)]);
      const speakers = new Set(data.listing.transcript.segments.map(s => s.speaker));
      summaryData.push(['Speakers', Array.from(speakers).join(', ')]);
      const wordCount = data.listing.transcript.segments.reduce(
        (sum, s) => sum + s.text.split(/\s+/).filter(w => w).length, 0
      );
      summaryData.push(['Word Count', String(wordCount)]);
    }

    autoTable(doc, {
      startY: y,
      head: [],
      body: summaryData,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: contentWidth - 40 },
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

    // ============ AI EVALUATION SECTION ============
    if (data.aiEval) {
      drawDivider(y);
      y += 10;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('AI Evaluation', margin, y);
      y += 10;

      const aiData: string[][] = [];
      aiData.push(['Status', data.aiEval.status.toUpperCase()]);
      aiData.push(['Model', data.aiEval.model]);
      aiData.push(['Evaluated', new Date(data.aiEval.createdAt).toLocaleString()]);

      const stats = data.aiEval.critique?.statistics;
      if (stats) {
        const matchPct = stats.totalSegments > 0
          ? ((stats.matchCount / stats.totalSegments) * 100).toFixed(1)
          : '0';
        aiData.push(['Match Rate', `${matchPct}% (${stats.matchCount}/${stats.totalSegments})`]);
        aiData.push(['Critical Issues', String(stats.criticalCount)]);
        aiData.push(['Moderate Issues', String(stats.moderateCount)]);
        aiData.push(['Minor Issues', String(stats.minorCount)]);
        aiData.push(['Original Correct', String(stats.originalCorrectCount)]);
        aiData.push(['Judge Correct', String(stats.judgeCorrectCount)]);
      }

      autoTable(doc, {
        startY: y,
        head: [],
        body: aiData,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 40 },
          1: { cellWidth: contentWidth - 40 },
        },
        margin: { left: margin, right: margin },
      });

      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

      // Overall assessment
      if (data.aiEval.critique?.overallAssessment) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Overall Assessment:', margin, y + 5);
        y += 10;
        
        doc.setFont('helvetica', 'normal');
        const assessmentLines = doc.splitTextToSize(
          data.aiEval.critique.overallAssessment,
          contentWidth
        );
        doc.text(assessmentLines, margin, y);
        y += assessmentLines.length * 5 + 10;
      }
    }

    // ============ HUMAN EVALUATION SECTION ============
    if (data.humanEval) {
      if (y > pageHeight - 80) {
        addNewPage();
        y = 20;
      }

      drawDivider(y);
      y += 10;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Human Evaluation', margin, y);
      y += 10;

      const humanData: string[][] = [];
      humanData.push(['Status', data.humanEval.status.toUpperCase()]);
      if (data.humanEval.overallScore) {
        humanData.push(['Overall Score', `${data.humanEval.overallScore}/5`]);
      }
      humanData.push(['Corrections Made', String(data.humanEval.corrections.length)]);
      humanData.push(['Last Updated', new Date(data.humanEval.updatedAt).toLocaleString()]);

      autoTable(doc, {
        startY: y,
        head: [],
        body: humanData,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 40 },
          1: { cellWidth: contentWidth - 40 },
        },
        margin: { left: margin, right: margin },
      });

      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

      // Notes
      if (data.humanEval.notes) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Notes:', margin, y + 5);
        y += 10;
        
        doc.setFont('helvetica', 'normal');
        const noteLines = doc.splitTextToSize(data.humanEval.notes, contentWidth);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 5 + 10;
      }
    }

    // ============ SEGMENT COMPARISON TABLE ============
    if (data.listing.transcript && data.aiEval?.critique?.segments) {
      addNewPage();
      y = 20;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Segment-by-Segment Comparison', margin, y);
      y += 10;

      const critiqueByIndex = new Map<number, SegmentCritique>();
      data.aiEval.critique.segments.forEach(c => critiqueByIndex.set(c.segmentIndex, c));

      const correctionByIndex = new Map<number, TranscriptCorrection>();
      if (data.humanEval?.corrections) {
        data.humanEval.corrections.forEach(c => correctionByIndex.set(c.segmentIndex, c));
      }

      // Only show segments with discrepancies or corrections
      const segmentData: (string | { content: string; styles?: { textColor?: [number, number, number] } })[][] = [];
      
      data.listing.transcript.segments.forEach((segment, index) => {
        const critique = critiqueByIndex.get(index);
        const correction = correctionByIndex.get(index);

        // Skip if no critique and no correction (perfect match, no human edit)
        if (!critique && !correction) return;
        if (critique?.severity === 'none' && !correction) return;

        const severityColor: [number, number, number] = critique?.severity === 'critical' ? [220, 53, 69]
          : critique?.severity === 'moderate' ? [255, 193, 7]
          : critique?.severity === 'minor' ? [23, 162, 184]
          : [40, 167, 69];

        segmentData.push([
          String(index + 1),
          segment.text,
          critique?.judgeText || '-',
          {
            content: critique?.severity?.toUpperCase() || 'NONE',
            styles: { textColor: severityColor },
          },
          critique?.likelyCorrect || '-',
          correction?.correctedText || '-',
        ]);
      });

      if (segmentData.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['#', 'Original Text', 'AI Judge Text', 'Severity', 'Likely Correct', 'Human Correction']],
          body: segmentData,
          theme: 'striped',
          styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
          headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 45 },
            2: { cellWidth: 45 },
            3: { cellWidth: 18 },
            4: { cellWidth: 20 },
            5: { cellWidth: 34 },
          },
          margin: { left: margin, right: margin },
          didDrawPage: () => {
            currentPage++;
          },
        });

        y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
      } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.text('No discrepancies found - all segments match.', margin, y);
        y += 15;
      }
    }

    // ============ CORRECTIONS DETAIL ============
    if (data.humanEval?.corrections && data.humanEval.corrections.length > 0) {
      if (y > pageHeight - 60) {
        addNewPage();
        y = 20;
      }

      drawDivider(y);
      y += 10;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Human Corrections Detail', margin, y);
      y += 10;

      const correctionData = data.humanEval.corrections.map((correction, i) => [
        String(i + 1),
        String(correction.segmentIndex + 1),
        correction.originalText,
        correction.correctedText,
        correction.reason || '-',
      ]);

      autoTable(doc, {
        startY: y,
        head: [['#', 'Seg', 'Original Text', 'Corrected Text', 'Reason']],
        body: correctionData,
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: 10 },
          2: { cellWidth: 55 },
          3: { cellWidth: 55 },
          4: { cellWidth: 42 },
        },
        margin: { left: margin, right: margin },
        didDrawPage: () => {
          currentPage++;
        },
      });
    }

    // Add footer to last page
    addFooter();

    return doc.output('blob');
  },
};
