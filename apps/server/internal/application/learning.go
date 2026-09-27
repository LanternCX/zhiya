package application

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
)

type Action struct {
	Action         string          `json:"action"`
	RunID          string          `json:"runId"`
	Message        json.RawMessage `json:"message"`
	ToolCallID     string          `json:"toolCallId"`
	Answer         *Answer         `json:"answer"`
	CorrectionText string          `json:"correctionText"`
	Revision       *int            `json:"revision"`
}
type Answer struct {
	Selected []string `json:"selected"`
	Text     string   `json:"text"`
	Skipped  bool     `json:"skipped"`
}
type savedMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCallID string          `json:"toolCallId"`
}
type savedCall struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

const RunLease = 45 * time.Second
const modelRunLease = 150 * time.Second

type LearningService struct {
	models data.Models
}

func NewLearningService(models data.Models) *LearningService {
	return &LearningService{models: models}
}

func (s *LearningService) ApplyAction(ctx context.Context, user string, input Action, requestID string) (domain.Conversation, any, error) {
	return ApplyLearningAction(ctx, s.models, user, input, requestID)
}

func (s *LearningService) Load(ctx context.Context, user string) (domain.Conversation, error) {
	var conversation domain.Conversation
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		var err error
		conversation, err = models.Learning.Load(ctx, user)
		return err
	})
	return conversation, err
}

func (s *LearningService) Snapshot(ctx context.Context, user string, afterSequence int) (domain.Conversation, error) {
	return s.models.Learning.Snapshot(ctx, user, afterSequence)
}

func (s *LearningService) ListenChanges(ctx context.Context, ready chan<- error, failed func(error), reconnected func(), receive func(domain.ConversationChange)) {
	s.models.ListenConversationChanges(ctx, ready, failed, reconnected, receive)
}

func (s *LearningService) AuthorizeModel(ctx context.Context, token, claimedUser string, available bool) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		if token == "" {
			return data.ErrInvalidSession
		}
		if _, err := models.Users.GetBySession(ctx, token, claimedUser); err != nil {
			return err
		}
		if !available {
			return Unavailable("知芽暂时无法开始教学，请稍后重试", nil)
		}
		return nil
	})
}

func (s *LearningService) ClaimModelRun(ctx context.Context, token, claimedUser, runID string, available bool) (string, error) {
	var userID string
	err := s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		if token == "" {
			return data.ErrInvalidSession
		}
		user, err := models.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		conversation, err := models.Learning.LoadForAction(ctx, user.ID)
		if err != nil {
			return err
		}
		if runID == "" || conversation.RunID != runID || time.Now().After(conversation.LeaseUntil) || conversation.Inference || conversation.Question != nil || FirstPendingCall(&conversation) != "" {
			return Conflict("会话状态已变化，请恢复后继续")
		}
		if !available {
			return Unavailable("知芽暂时无法开始交流，请稍后重试", nil)
		}
		conversation.Inference = true
		conversation.LeaseUntil = time.Now().Add(modelRunLease)
		userID = user.ID
		return models.Learning.Save(ctx, user.ID, &conversation)
	})
	return userID, err
}

func (s *LearningService) FinishModelRun(ctx context.Context, user, runID string, completed bool) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		conversation, err := models.Learning.Load(ctx, user)
		if err != nil {
			return err
		}
		if conversation.RunID != runID {
			return nil
		}
		conversation.Inference = false
		if completed {
			conversation.LeaseUntil = time.Now().Add(RunLease)
		} else {
			conversation.RunID = ""
			conversation.LeaseUntil = time.Time{}
			if conversation.Question != nil {
				conversation.Status = "waiting"
			} else {
				conversation.Status = "idle"
			}
		}
		return models.Learning.Save(ctx, user, &conversation)
	})
}

func ApplyLearningAction(ctx context.Context, models data.Models, user string, input Action, requestID string) (domain.Conversation, any, error) {
	var state domain.Conversation
	var output any
	var response any
	err := models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var err error
		state, err = m.Learning.LoadForAction(ctx, user)
		if err != nil {
			return err
		}
		if requestID != "" {
			cached, found, err := m.Learning.RequestResult(ctx, state.ID, requestID)
			if err != nil {
				return err
			}
			if found {
				return json.Unmarshal(cached, &response)
			}
		}
		switch input.Action {
		case "claim":
			if input.CorrectionText != "" {
				if !state.Completed || input.Revision == nil || *input.Revision != state.Revision || state.Question != nil || FirstPendingCall(&state) != "" {
					return Conflict("会话已变化，请重新发起修改")
				}
				if strings.TrimSpace(input.CorrectionText) == "" || len(input.CorrectionText) > 16000 {
					return Invalid("请简要说明修改内容")
				}
			} else if state.CorrectionEnded {
				return Conflict("本次修改已结束，请重新发起修改")
			}
			if state.RunID != "" && time.Now().Before(state.LeaseUntil) {
				return Conflict("正在处理中，请稍候")
			}
			if input.CorrectionText != "" {
				state.CorrectionEnded = false
				message, _ := json.Marshal(map[string]any{"role": "user", "content": []any{map[string]string{"type": "text", "text": input.CorrectionText}}, "timestamp": time.Now().UnixMilli()})
				state.Messages = append(state.Messages, message)
			}
			state.RunID = identifier.New()
			state.Inference = false
			state.LeaseUntil = time.Now().Add(RunLease)
			if state.Question != nil {
				state.Status = "waiting"
			} else {
				state.Status = "running"
			}
			output = map[string]string{"runId": state.RunID}
		case "end_correction":
			if !state.Completed {
				return Conflict("首次建档请保留进度后退出")
			}
			for id := FirstPendingCall(&state); id != ""; id = FirstPendingCall(&state) {
				call := findCall(&state, id)
				appendToolResult(&state, id, call.Name, map[string]string{"error": "The student ended this correction. Do not resume it."}, true)
			}
			state.Question = nil
			state.RunID = ""
			state.Inference = false
			state.LeaseUntil = time.Time{}
			state.Status = "idle"
			state.CorrectionEnded = true
		case "answer":
			if state.Question == nil || input.ToolCallID != state.Question.ID {
				return Conflict("这道问题已更新，请查看最新内容")
			}
			if input.Answer == nil {
				return Invalid("请提交回答")
			}
			if err = validateAnswer(state.Question, input.Answer); err != nil {
				return err
			}
			appendToolResult(&state, input.ToolCallID, "ask_student", input.Answer, false)
			state.Question = nil
			state.Status = "running"
		default:
			if input.RunID == "" || input.RunID != state.RunID || time.Now().After(state.LeaseUntil) {
				return Conflict("本轮执行已中断，请恢复会话")
			}
			if !state.Inference {
				state.LeaseUntil = time.Now().Add(RunLease)
			}
			switch input.Action {
			case "heartbeat":
			case "release":
				state.RunID = ""
				state.LeaseUntil = time.Time{}
				if state.Question != nil {
					state.Status = "waiting"
				} else {
					state.Status = "idle"
				}
			case "message":
				if state.Inference {
					return Conflict("模型仍在生成，请稍候")
				}
				if len(state.Messages) > 0 {
					var previous, current any
					_ = json.Unmarshal(state.Messages[len(state.Messages)-1], &previous)
					_ = json.Unmarshal(input.Message, &current)
					previousJSON, _ := json.Marshal(previous)
					currentJSON, _ := json.Marshal(current)
					if bytes.Equal(previousJSON, currentJSON) {
						break
					}
				}
				var msg savedMessage
				if json.Unmarshal(input.Message, &msg) != nil || (msg.Role != "assistant" && msg.Role != "user") {
					return Invalid("消息格式无效")
				}
				if state.Question != nil {
					return Conflict("请先回答当前问题")
				}
				if FirstPendingCall(&state) != "" {
					return Conflict("请先完成当前工具调用")
				}
				if msg.Role == "assistant" {
					var blocks []savedCall
					if json.Unmarshal(msg.Content, &blocks) != nil {
						return Invalid("模型消息格式无效")
					}
					seen := map[string]bool{}
					for _, b := range blocks {
						if b.Type == "toolCall" {
							if b.ID == "" || seen[b.ID] || findCall(&state, b.ID) != nil {
								return Invalid("工具调用标识重复或无效")
							}
							seen[b.ID] = true
						}
					}
				}
				// A repeated save after a lost HTTP response must not duplicate the message.
				if len(state.Messages) == 0 || !bytes.Equal(state.Messages[len(state.Messages)-1], input.Message) {
					state.Messages = append(state.Messages, input.Message)
				}
			case "tool_error":
				call := findCall(&state, input.ToolCallID)
				if call == nil || FirstPendingCall(&state) != input.ToolCallID || state.Question != nil {
					return Conflict("工具状态已变化")
				}
				appendToolResult(&state, call.ID, call.Name, map[string]string{"error": "工具参数未通过客户端校验，请检查工具定义后重试"}, true)
			case "tool":
				if state.Inference {
					return Conflict("模型仍在生成，请稍候")
				}
				if state.Question != nil && state.Question.ID == input.ToolCallID {
					output = map[string]any{"waiting": true}
					break
				}
				if result := findResult(&state, input.ToolCallID); result != nil {
					output = map[string]any{"result": result}
					break
				}
				call := findCall(&state, input.ToolCallID)
				if call == nil {
					return Invalid("找不到对应的工具调用")
				}
				// Calls are executed in the assistant's order, including after restoration.
				if FirstPendingCall(&state) != input.ToolCallID {
					return Conflict("请按会话顺序执行工具")
				}
				result, toolErr := executeLearningTool(&state, *call)
				if toolErr != nil {
					appendToolResult(&state, call.ID, call.Name, map[string]string{"error": toolErr.Error()}, true)
				} else if state.Question == nil {
					appendToolResult(&state, call.ID, call.Name, result, false)
				}
				if state.Question != nil {
					output = map[string]any{"waiting": true}
				} else {
					output = map[string]any{"result": findResult(&state, call.ID)}
				}
			default:
				return Invalid("未知会话操作")
			}
		}
		if err := m.Learning.Save(ctx, user, &state); err != nil {
			return err
		}
		response = output
		if requestID != "" {
			raw, err := json.Marshal(response)
			if err != nil {
				return err
			}
			return m.Learning.SaveRequestResult(ctx, state.ID, requestID, raw)
		}
		return nil
	})
	if err != nil {
		return domain.Conversation{}, nil, err
	}
	state.RunID = ""
	return state, response, nil
}

func validateAnswer(q *domain.Question, a *Answer) error {
	if len(a.Text) > 4000 {
		return Invalid("回答太长，请简短一些")
	}
	if a.Skipped {
		if len(a.Selected) > 0 || a.Text != "" {
			return Invalid("跳过时无需提交答案")
		}
		return nil
	}
	if len(a.Selected) == 0 && strings.TrimSpace(a.Text) == "" {
		return Invalid("请选择或填写回答")
	}
	if (q.Kind == "single" && len(a.Selected) > 1) || (q.Kind == "text" && len(a.Selected) > 0) {
		return Invalid("回答方式不符合当前问题")
	}
	seen := map[string]bool{}
	for _, v := range a.Selected {
		valid := false
		for _, o := range q.Options {
			if o == v {
				valid = true
			}
		}
		if !valid || seen[v] {
			return Invalid("选项无效，请查看最新问题")
		}
		seen[v] = true
	}
	return nil
}

func findCall(c *domain.Conversation, id string) *savedCall {
	for _, raw := range c.Messages {
		var msg savedMessage
		_ = json.Unmarshal(raw, &msg)
		if msg.Role != "assistant" {
			continue
		}
		var blocks []savedCall
		_ = json.Unmarshal(msg.Content, &blocks)
		for _, b := range blocks {
			if b.Type == "toolCall" && b.ID == id {
				return &b
			}
		}
	}
	return nil
}
func findResult(c *domain.Conversation, id string) json.RawMessage {
	for _, raw := range c.Messages {
		var m savedMessage
		_ = json.Unmarshal(raw, &m)
		if m.Role == "toolResult" && m.ToolCallID == id {
			return raw
		}
	}
	return nil
}
func FirstPendingCall(c *domain.Conversation) string {
	for _, raw := range c.Messages {
		var m savedMessage
		_ = json.Unmarshal(raw, &m)
		if m.Role != "assistant" {
			continue
		}
		var blocks []savedCall
		_ = json.Unmarshal(m.Content, &blocks)
		for _, b := range blocks {
			if b.Type == "toolCall" && findResult(c, b.ID) == nil {
				return b.ID
			}
		}
	}
	return ""
}
func appendToolResult(c *domain.Conversation, id, name string, result any, isError bool) {
	value, _ := json.Marshal(result)
	raw, _ := json.Marshal(map[string]any{"role": "toolResult", "toolCallId": id, "toolName": name, "content": []any{map[string]string{"type": "text", "text": string(value)}}, "details": result, "isError": isError, "timestamp": time.Now().UnixMilli()})
	c.Messages = append(c.Messages, raw)
}
func executeLearningTool(c *domain.Conversation, call savedCall) (any, error) {
	switch call.Name {
	case "ask_student":
		if c.Question != nil {
			return nil, errors.New("已有问题等待回答")
		}
		var q domain.Question
		if json.Unmarshal(call.Arguments, &q) != nil || strings.TrimSpace(q.Text) == "" || len(q.Text) > 2000 || len(q.Description) > 4000 {
			return nil, errors.New("请提供一个简短、明确的问题")
		}
		if q.Kind != "single" && q.Kind != "multiple" && q.Kind != "text" {
			return nil, errors.New("问题类型应为 single、multiple 或 text")
		}
		if q.Kind != "text" && (len(q.Options) < 2 || len(q.Options) > 8) {
			return nil, errors.New("选择题需提供 2–8 个选项")
		}
		seen := map[string]bool{}
		for _, s := range q.Options {
			if strings.TrimSpace(s) == "" || len(s) > 500 || seen[s] {
				return nil, errors.New("选项应简短、不重复")
			}
			seen[s] = true
		}
		q.ID = call.ID
		c.Question = &q
		c.Status = "waiting"
		return nil, nil
	case "read_memory":
		return map[string]any{"content": c.Memory, "version": c.MemoryVersion}, nil
	case "update_memory":
		var v struct {
			Content string `json:"content"`
			Version int    `json:"version"`
		}
		if json.Unmarshal(call.Arguments, &v) != nil || len(v.Content) > 32000 {
			return nil, errors.New("记忆内容无效或过长")
		}
		if v.Version != c.MemoryVersion {
			return nil, errors.New("记忆版本已变化，请先读取最新记忆")
		}
		c.Memory = v.Content
		c.MemoryVersion++
		return map[string]any{"content": c.Memory, "version": c.MemoryVersion}, nil
	case "complete_onboarding":
		c.Completed = true
		return map[string]bool{"completed": true}, nil
	default:
		return nil, errors.New("未知工具")
	}
}
