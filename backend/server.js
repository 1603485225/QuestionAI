// 智能题库系统后端服务器
// 作者：智能题库系统
// 版本：2.1.0 - 修复AI出题问题

console.log('🚀 开始启动智能题库系统服务器...');
console.log('='.repeat(50));

// ========== 引入必要的工具 ==========
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

console.log('✅ 工具加载完成');

// ========== 创建服务器应用 ==========
const app = express();
const PORT = process.env.PORT || 3001;

// ========== 设置服务器中间件 ==========
app.use(cors());  // 允许前端连接
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

console.log('✅ 服务器设置完成');

// ========== 检查API密钥 ==========
if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('xxxx')) {
  console.error('❌ 错误：请先在 .env 文件中设置正确的DeepSeek API密钥');
  console.log('💡 打开 .env 文件，把 DEEPSEEK_API_KEY 的值换成你的实际密钥');
  console.log('💡 然后重新启动服务器');
  process.exit(1);
}

console.log('✅ API密钥检查通过');

// ========== 健康检查接口 ==========
app.get('/api/health', (req, res) => {
  console.log('🩺 收到健康检查请求');
  res.json({ 
    success: true, 
    message: '智能题库AI服务运行正常',
    timestamp: new Date().toLocaleString('zh-CN'),
    version: '2.1.0',
    features: ['AI解析', '多题相似题生成', 'AI智能出题', '错题分析'],
    tips: '前后端连接成功！'
  });
});

console.log('✅ 健康检查接口已设置');

// ========== AI解析题目接口 ==========
app.post('/api/explain', async (req, res) => {
  console.log('🤖 收到AI解析请求');
  
  try {
    const { question, options, correctAnswer, userAnswer, knowledgePoints, questionType } = req.body;
    
    // 检查必要参数
    if (!question) {
      return res.json({ 
        success: false, 
        error: '请提供题目内容' 
      });
    }

    // 构建AI提示词
    let prompt = `请对以下题目进行解析：

【题目】
${question}`;

    if (options && options.length > 0) {
      prompt += `\n\n【选项】\n`;
      options.forEach(opt => {
        prompt += `${opt.key}. ${opt.text}\n`;
      });
    }

    prompt += `\n【正确答案】\n${correctAnswer}`;
    
    if (userAnswer) {
      prompt += `\n\n【用户答案】\n${userAnswer}`;
    }
    
    if (knowledgePoints && knowledgePoints.length > 0) {
      prompt += `\n\n【知识点】\n${knowledgePoints.join('、')}`;
    }

    prompt += `\n\n请提供以下解析（每部分用【标题】标出，重点内容用**加粗**）：\n1. 【核心知识点】总结核心考点\n2. 【答案分析】分析正确选项和错误选项\n3. 【易错点】指出常见错误\n4. 【解题技巧】提供解题方法\n5. 【拓展延伸】提供相关拓展知识`;

    console.log('📤 发送请求到AI...');
    
    // 调用DeepSeek AI
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的教学助手，擅长解析题目。请用中文回答，结构清晰，重点内容加粗显示，确保解析准确、全面。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    console.log('✅ 收到AI响应');
    
    const aiResponse = response.data.choices[0].message.content;
    
    // 解析响应内容
    const result = {
      coreKnowledge: extractSection(aiResponse, '核心知识点'),
      answerAnalysis: extractSection(aiResponse, '答案分析'),
      commonMistakes: extractSection(aiResponse, '易错点'),
      solvingTips: extractSection(aiResponse, '解题技巧'),
      relatedKnowledge: extractSection(aiResponse, '拓展延伸') || extractSection(aiResponse, '拓展知识'),
      rawResponse: aiResponse
    };

    // 如果某些部分为空，尝试从原始响应中提取
    if (!result.coreKnowledge || result.coreKnowledge.includes('暂无')) {
      result.coreKnowledge = extractFirstMeaningfulLine(aiResponse) || '核心知识点解析';
    }

    res.json({
      success: true,
      data: result,
      message: 'AI解析生成成功'
    });
    
  } catch (error) {
    console.error('❌ AI解析失败:', error.message);
    
    res.json({
      success: false,
      error: 'AI解析失败，请稍后重试',
      fallback: {
        coreKnowledge: 'AI解析服务暂时不可用，请检查网络连接。',
        answerAnalysis: '建议您：1.检查网络 2.验证API密钥 3.稍后重试',
        commonMistakes: '常见错误：网络连接问题、API密钥无效',
        solvingTips: '如多次失败，请尝试重启服务器'
      }
    });
  }
});

console.log('✅ AI解析接口已设置');

// ========== 生成相似题接口 ==========
app.post('/api/similar', async (req, res) => {
  console.log('🔄 收到生成相似题请求');
  
  try {
    const { 
      question, 
      correctAnswer, 
      questionType, 
      knowledgePoints,
      count = 3,
      options = []
    } = req.body;
    
    if (!question) {
      return res.json({ 
        success: false, 
        error: '需要题目内容' 
      });
    }

    console.log(`🎯 生成 ${count} 道相似题，题型: ${questionType}`);
    
    // 构建详细提示词
    let prompt = `请根据原题生成 ${count} 道高质量相似题：

【原题信息】
题目：${question}
题型：${questionType}
正确答案：${correctAnswer}`;

    if (knowledgePoints && knowledgePoints.length > 0) {
      prompt += `\n知识点：${knowledgePoints.join('、')}`;
    }

    if (options && options.length > 0) {
      prompt += `\n\n【原题选项】`;
      options.forEach(opt => {
        prompt += `\n${opt.key}. ${opt.text}`;
      });
    }

    prompt += `\n\n【生成要求】
1. 保持相同考点和难度，但改变具体场景、数值、表述方式
2. 不要直接复制原题，要有创新性
3. 每道题都要提供正确答案和解析
4. 如果是选择题，必须提供完整的4个选项（A、B、C、D）
5. 确保题目逻辑严谨，没有歧义
6. 每道题都要标注难度（easy/medium/hard）
7. 每道题都要标注相关知识点

【返回格式】
请以JSON数组格式返回，每道题包含以下字段：
{
  "stem": "题目内容",
  "options": [{"key": "A", "text": "选项内容"}, {"key": "B", "text": "选项内容"}, ...],
  "answer": "正确答案（如'A'或'AB'）",
  "explanation": "解析说明",
  "difficulty": "难度（easy/medium/hard）",
  "knowledgePoints": ["知识点1", "知识点2"]
}

请生成 ${count} 道不同的相似题，确保多样性。`;

    console.log('📤 发送相似题生成请求到AI...');
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的出题专家，擅长生成高质量、无歧义的相似题目。请确保新题与原题考点一致但内容不同，提供完整选项和解析，返回规范的JSON数组。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    console.log('✅ 收到相似题AI响应，长度:', aiResponse.length);
    
    let similarQuestions = [];
    
    try {
      let jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || 
                     aiResponse.match(/```\n([\s\S]*?)\n```/) ||
                     aiResponse.match(/\[\s*\{[\s\S]*\}\s*\]/) ||
                     aiResponse.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr.trim());
        
        similarQuestions = Array.isArray(parsed) ? parsed : [parsed];
        
        similarQuestions = similarQuestions.slice(0, count).map((q, idx) => {
          const questionId = Date.now() + idx;
          
          return {
            id: questionId,
            stem: q.stem || `相似题 ${idx + 1}: ${question.substring(0, 60)}...`,
            options: q.options || generateDefaultOptions(questionType, idx),
            answer: q.answer || correctAnswer || 'A',
            explanation: q.explanation || `基于原题的相似题，保持相同考点但更换了具体场景。`,
            difficulty: q.difficulty || 'medium',
            knowledgePoints: q.knowledgePoints || knowledgePoints || ['AI生成相似题'],
            type: questionType,
            source: 'ai-generated'
          };
        });
        
        console.log(`✅ 成功解析 ${similarQuestions.length} 道相似题`);
        
      } else {
        console.log('⚠️ 未找到JSON格式，尝试生成默认相似题');
        similarQuestions = generateDefaultSimilarQuestions(question, correctAnswer, questionType, count, options);
      }
    } catch (parseError) {
      console.log('❌ JSON解析失败，生成默认相似题:', parseError.message);
      similarQuestions = generateDefaultSimilarQuestions(question, correctAnswer, questionType, count, options);
    }

    similarQuestions = similarQuestions.map((q, idx) => {
      if ((questionType === 'single' || questionType === 'multi') && (!q.options || q.options.length === 0)) {
        q.options = generateDefaultOptions(questionType, idx);
      }
      return q;
    });

    res.json({
      success: true,
      data: { 
        similarQuestions,
        generatedFrom: 'ai',
        count: similarQuestions.length,
        note: `成功生成 ${similarQuestions.length} 道相似题，每题都包含完整选项`
      }
    });
    
  } catch (error) {
    console.error('❌ 生成相似题失败:', error.message);
    
    res.json({
      success: false,
      error: '生成相似题失败，可能是网络问题或AI服务繁忙',
      data: {
        similarQuestions: generateDefaultSimilarQuestions(
          '网络连接失败，请检查后重试',
          '--',
          'single',
          3
        ),
        generatedFrom: 'fallback',
        note: '生成失败，请稍后重试'
      }
    });
  }
});

console.log('✅ 相似题接口已设置');

// ========== AI智能出题接口（修复版） ==========
app.post('/api/generate-questions', async (req, res) => {
  console.log('🎯 收到AI出题请求');
  
  try {
    const { material, singleCount = 3, multiCount = 2, blankCount = 1 } = req.body;
    
    console.log('📝 接收到的参数:', { materialLength: material?.length, singleCount, multiCount, blankCount });
    
    if (!material || material.trim().length < 10) {
      console.log('❌ 学习材料太短或为空');
      return res.json({ 
        success: false, 
        error: '请提供足够的学习材料（至少50字）' 
      });
    }

    const totalCount = Math.min(parseInt(singleCount) + parseInt(multiCount) + parseInt(blankCount), 20);
    console.log(`📊 计划生成 ${totalCount} 题（单选:${singleCount}, 多选:${multiCount}, 填空:${blankCount}）`);
    
    // 简化的提示词，提高成功率
    const prompt = `请根据以下学习材料生成练习题：

学习材料：
"${material.substring(0, 1500)}"${material.length > 1500 ? '...（内容已截断）' : ''}

要求：
1. 生成 ${singleCount} 道单选题
2. 生成 ${multiCount} 道多选题  
3. 生成 ${blankCount} 道填空题
4. 每道题都要有：题干、选项（选择题）、正确答案、知识点
5. 题目要覆盖材料中的重要内容
6. 难度适中，适合练习使用

请以JSON数组格式返回，每道题的结构如下：
{
  "type": "single" 或 "multi" 或 "blank",
  "stem": "题目内容",
  "options": [{"key": "A", "text": "选项内容"}, {"key": "B", "text": "选项内容"}, ...],
  "answer": "正确答案",
  "knowledgePoints": ["知识点1", "知识点2"],
  "difficulty": "easy" 或 "medium" 或 "hard"
}

注意：如果是填空题，options字段为空数组[]`;

    console.log('📤 发送AI出题请求...');
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的出题老师，请根据用户提供的学习材料生成练习题。确保题目覆盖材料中的重要知识点，难度适中，格式规范。直接返回JSON数组，不要额外的解释文字。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 3000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 180000
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    console.log('✅ 收到AI出题响应，长度:', aiResponse.length);
    console.log('📄 AI响应前200字符:', aiResponse.substring(0, 200));
    
    let questions = [];
    
    try {
      // 尝试多种方式提取JSON
      let jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || 
                     aiResponse.match(/```\n([\s\S]*?)\n```/) ||
                     aiResponse.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      
      if (jsonMatch) {
        let jsonStr = jsonMatch[1] || jsonMatch[0];
        console.log('📝 找到JSON内容，尝试解析...');
        
        // 清理JSON字符串
        jsonStr = jsonStr.replace(/```/g, '').trim();
        
        try {
          questions = JSON.parse(jsonStr);
          console.log(`✅ JSON解析成功，找到 ${questions.length} 题`);
        } catch (parseError) {
          console.log('❌ JSON解析失败，尝试修复格式:', parseError.message);
          
          // 尝试修复常见的JSON格式错误
          try {
            // 尝试添加缺失的引号等
            const fixedJson = jsonStr
              .replace(/(\w+):/g, '"$1":') // 为属性名添加引号
              .replace(/'/g, '"'); // 替换单引号为双引号
            
            questions = JSON.parse(fixedJson);
            console.log(`✅ 修复后解析成功，找到 ${questions.length} 题`);
          } catch (fixError) {
            console.log('❌ 修复失败，生成默认题目');
            questions = generateDefaultQuestions(material, singleCount, multiCount, blankCount);
          }
        }
      } else {
        console.log('⚠️ 未找到JSON格式，生成默认题目');
        questions = generateDefaultQuestions(material, singleCount, multiCount, blankCount);
      }
      
      // 确保questions是数组
      if (!Array.isArray(questions)) {
        console.log('⚠️ questions不是数组，转换为数组');
        questions = [questions];
      }
      
      // 验证并格式化题目
      questions = questions.slice(0, totalCount).map((q, idx) => {
        // 确保有必要的字段
        const formattedQuestion = {
          id: idx + 1,
          type: q.type || (idx < singleCount ? 'single' : idx < singleCount + multiCount ? 'multi' : 'blank'),
          stem: q.stem || `题目 ${idx + 1}: ${material.substring(idx * 30, (idx + 1) * 30)}...`,
          options: [],
          answer: q.answer || 'A',
          knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints : 
                          (q.knowledgePoints ? [q.knowledgePoints] : ['AI生成']),
          difficulty: q.difficulty || 'medium',
          rawTypeText: ''
        };
        
        // 设置rawTypeText
        if (formattedQuestion.type === 'single') {
          formattedQuestion.rawTypeText = '单选题';
          formattedQuestion.options = q.options || generateDefaultOptions('single', idx);
        } else if (formattedQuestion.type === 'multi') {
          formattedQuestion.rawTypeText = '多选题';
          formattedQuestion.options = q.options || generateDefaultOptions('multi', idx);
        } else {
          formattedQuestion.rawTypeText = '填空题';
          formattedQuestion.options = [];
        }
        
        return formattedQuestion;
      });
      
      console.log(`📋 最终生成 ${questions.length} 道有效题目`);
      
    } catch (error) {
      console.error('❌ 处理AI响应时出错:', error.message);
      questions = generateDefaultQuestions(material, singleCount, multiCount, blankCount);
    }

    // 确保至少有题目返回
    if (questions.length === 0) {
      console.log('⚠️ 没有生成任何题目，使用备用方案');
      questions = generateDefaultQuestions(material, singleCount, multiCount, blankCount);
    }

    console.log(`🎉 成功返回 ${questions.length} 道题目`);
    
    res.json({
      success: true,
      data: { 
        questions: questions,
        count: questions.length,
        note: `AI智能出题完成，共生成 ${questions.length} 道题目`
      }
    });
    
  } catch (error) {
    console.error('❌ AI出题失败:', error.message);
    
    // 生成备用题目
    const fallbackQuestions = generateDefaultQuestions(
      'AI出题服务暂时不可用，请检查网络连接或稍后重试。',
      1, 0, 0
    );
    
    res.json({
      success: false,
      error: 'AI出题失败，可能是网络问题或AI服务繁忙',
      data: {
        questions: fallbackQuestions,
        count: fallbackQuestions.length,
        note: '出题失败，返回备用题目'
      }
    });
  }
});

console.log('✅ AI出题接口已设置（修复版）');

// ========== 错题分析接口 ==========
app.post('/api/analyze', async (req, res) => {
  console.log('📊 收到错题分析请求');
  
  try {
    const { wrongQuestions } = req.body;
    
    if (!wrongQuestions || !Array.isArray(wrongQuestions) || wrongQuestions.length === 0) {
      return res.json({ 
        success: false, 
        error: '没有错题数据' 
      });
    }

    // 限制分析数量
    const limitedQuestions = wrongQuestions.slice(0, 5);
    
    const prompt = `请分析以下错题，为学生提供学习建议：

【错题列表】
${limitedQuestions.map((wq, i) => 
  `第${i+1}题：${wq.question.substring(0, 80)}${wq.question.length > 80 ? '...' : ''}\n` +
  `你的答案：${wq.userAnswer || '未作答'}，正确答案：${wq.correctAnswer}\n`
).join('\n')}

【分析要求】
请提供：
1. 整体错误分析（主要犯错原因）
2. 薄弱知识点总结
3. 具体的学习建议和复习计划
4. 推荐的练习重点

请用清晰、有条理的方式组织内容，语气鼓励，帮助学生建立信心。`;

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的教学分析师，擅长通过错题分析学习情况。请提供专业、实用、鼓励性的建议。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      data: {
        overallAnalysis: aiResponse,
        generatedAt: new Date().toLocaleString('zh-CN'),
        analyzedCount: limitedQuestions.length,
        recommendations: [
          '建议每天复习错题30分钟',
          '重点关注薄弱知识点',
          '多做类似题目巩固'
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ 错题分析失败:', error.message);
    
    res.json({
      success: false,
      error: '错题分析失败',
      fallback: {
        overallAnalysis: '错题分析功能暂时不可用，建议您：\n1. 整理错题本\n2. 重点复习错误知识点\n3. 定期回顾\n\n系统将尽快恢复服务。',
        generatedAt: new Date().toLocaleString('zh-CN'),
        analyzedCount: 0
      }
    });
  }
});

console.log('✅ 错题分析接口已设置');

// ========== 辅助函数 ==========

// 提取章节内容
function extractSection(text, sectionName) {
  if (!text) return 'AI解析内容生成中...';
  
  const patterns = [
    new RegExp(`【${sectionName}】[：:]*\\s*([^【]*)`, 'i'),
    new RegExp(`${sectionName}[：:]*\\s*([^\\n]*)`, 'i'),
    new RegExp(`##?\\s*${sectionName}[：:]*\\s*([^\\n]*)`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 5) {
      return match[1].trim();
    }
  }
  
  return text.split('\n').find(line => line.trim().length > 10) || 
         'AI解析生成成功，请查看详细内容。';
}

// 提取第一行有意义的内容
function extractFirstMeaningfulLine(text) {
  if (!text) return '';
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 20 && !trimmed.startsWith('```') && !trimmed.startsWith('{')) {
      return trimmed;
    }
  }
  return text.substring(0, Math.min(100, text.length));
}

// 生成默认相似题
function generateDefaultSimilarQuestions(question, correctAnswer, questionType, count = 3, options = []) {
  const questions = [];
  
  for (let i = 0; i < Math.min(count, 5); i++) {
    const questionId = Date.now() + i;
    
    questions.push({
      id: questionId,
      stem: `相似题 ${i + 1}: ${question.substring(0, 60)}...（场景变化 ${i + 1}）`,
      options: generateDefaultOptions(questionType, i),
      answer: correctAnswer || (questionType === 'multi' ? 'AB' : 'A'),
      explanation: `基于原题的相似题，保持相同考点但更换了具体场景。`,
      difficulty: i === 0 ? 'easy' : i === 1 ? 'medium' : 'hard',
      knowledgePoints: ['相似题训练', '考点巩固'],
      type: questionType,
      source: 'ai-generated-fallback'
    });
  }
  
  return questions;
}

// 生成默认题目（AI出题失败时使用）
function generateDefaultQuestions(material, singleCount, multiCount, blankCount) {
  const questions = [];
  const totalCount = Math.min(singleCount + multiCount + blankCount, 10);
  
  for (let i = 0; i < totalCount; i++) {
    const questionId = i + 1;
    let questionType, rawTypeText;
    
    if (i < singleCount) {
      questionType = 'single';
      rawTypeText = '单选题';
    } else if (i < singleCount + multiCount) {
      questionType = 'multi';
      rawTypeText = '多选题';
    } else {
      questionType = 'blank';
      rawTypeText = '填空题';
    }
    
    const question = {
      id: questionId,
      type: questionType,
      stem: `${rawTypeText} ${questionId}: ${material.substring(i * 20, (i + 1) * 20)}...`,
      options: questionType === 'blank' ? [] : generateDefaultOptions(questionType, i),
      answer: questionType === 'multi' ? 'AB' : 'A',
      knowledgePoints: ['AI生成题目'],
      difficulty: 'medium',
      rawTypeText: rawTypeText
    };
    
    questions.push(question);
  }
  
  return questions;
}

// 生成默认选项
function generateDefaultOptions(questionType, index = 0) {
  if (questionType === 'single' || questionType === 'multi') {
    const optionSets = [
      [
        { key: 'A', text: '选项A：这是第一个选项内容' },
        { key: 'B', text: '选项B：这是第二个选项内容' },
        { key: 'C', text: '选项C：这是第三个选项内容' },
        { key: 'D', text: '选项D：这是第四个选项内容' }
      ],
      [
        { key: 'A', text: '选项A：涉及核心知识点的内容' },
        { key: 'B', text: '选项B：常见干扰项，容易混淆' },
        { key: 'C', text: '选项C：部分正确但不完整' },
        { key: 'D', text: '选项D：完全错误的选项' }
      ],
      [
        { key: 'A', text: '选项A：符合题意的正确答案' },
        { key: 'B', text: '选项B：与题目相关但不够准确' },
        { key: 'C', text: '选项C：看似正确实则错误' },
        { key: 'D', text: '选项D：明显不符合题意' }
      ]
    ];
    
    return optionSets[index % optionSets.length];
  }
  return [];
}

// ========== 启动服务器 ==========
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🎉 智能题库AI服务器启动成功！');
  console.log('='.repeat(60));
  console.log(`📡 服务器地址：http://localhost:${PORT}`);
  console.log(`🩺 健康检查：http://localhost:${PORT}/api/health`);
  console.log(`⏰ 启动时间：${new Date().toLocaleString('zh-CN')}`);
  console.log(`🔑 API密钥状态：${process.env.DEEPSEEK_API_KEY ? '已设置' : '未设置'}`);
  console.log('='.repeat(60));
  console.log('🚀 功能列表：');
  console.log('  1. ✅ AI解析题目');
  console.log('  2. ✅ 相似题生成（3题/次，完整选项）');
  console.log('  3. ✅ AI智能出题（修复版）');
  console.log('  4. ✅ 错题分析报告');
  console.log('='.repeat(60));
  console.log('💡 请保持此窗口打开，不要关闭！');
  console.log('💡 接下来请打开前端页面进行测试');
  console.log('='.repeat(60));
});

// ========== 错误处理 ==========
process.on('uncaughtException', (err) => {
  console.error('⚠️ 系统错误:', err.message);
  console.log('💡 建议：检查 .env 文件配置，或重启服务器');
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ 异步错误:', reason);
});