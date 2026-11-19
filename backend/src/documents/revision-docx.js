const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');

const font = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei', cs: 'Calibri' };
const clean = text => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s+/g, ' ').trim();

function paragraph(text, { size = 22, bold = false, ...options } = {}) {
  return new Paragraph({
    ...options,
    children: [new TextRun({ text: clean(text), size, bold, color: '000000', font })]
  });
}

function packRevisionDocx({ title, metadata, sections, evidenceLocation }) {
  const children = [
    paragraph(title, { heading: HeadingLevel.TITLE, size: 46, bold: true, spacing: { after: 250 } }),
    ...metadata.map(text => paragraph(text, { spacing: { after: 100, line: 340 } }))
  ];
  if (!sections.length) children.push(paragraph('本次未提取到论文修改意见。', { spacing: { before: 280 } }));
  for (const [sectionIndex, { category, tasks }] of sections.entries()) {
    children.push(paragraph((sectionIndex + 1) + ' ' + category, {
      heading: HeadingLevel.HEADING_1, size: 30, bold: true, keepNext: true, spacing: { before: 260, after: 120 }
    }));
    for (const [taskIndex, task] of tasks.entries()) {
      children.push(paragraph((taskIndex + 1) + '. ' + task.action, {
        bold: true, keepNext: task.evidence.length > 0, spacing: { before: 140, after: 100, line: 360 }
      }));
      for (const item of task.evidence) {
        children.push(paragraph(evidenceLocation(item) + '　“' + item.quote + '”', {
          size: 20, indent: { left: 360 }, spacing: { after: 120, line: 340 }
        }));
      }
    }
  }
  return Packer.toBuffer(new Document({
    creator: 'AskFlow',
    title,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1360, left: 1500, bottom: 1360, right: 1500 } } },
      children
    }]
  }));
}

module.exports = { packRevisionDocx };
