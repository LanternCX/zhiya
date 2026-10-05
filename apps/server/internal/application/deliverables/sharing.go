package deliverables

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"slices"

	fault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Service) SharedImage(ctx context.Context, auth identity.Authorize, token, id string) (io.ReadCloser, error) {
	var key string
	err := s.shared(ctx, auth, token, func(m data.Models, share data.DeliverableShare, item domain.Deliverable) error {
		if !slices.ContainsFunc(item.Blocks, func(block domain.DeliverableBlock) bool { return slices.Contains(block.ImageIDs, id) }) {
			return missing(pgx.ErrNoRows)
		}
		var err error
		key, err = m.Deliverables.Image(ctx, share.CourseID, id)
		if errors.Is(err, pgx.ErrNoRows) {
			illustration, e := m.Illustrations.Get(ctx, share.OwnerID, share.CourseID, id)
			if e != nil || illustration.Status != "complete" {
				return missing(pgx.ErrNoRows)
			}
			key, err = illustration.ObjectKey, nil
		}
		return missing(err)
	})
	if err != nil {
		return nil, err
	}
	reader, _, err := s.objects.Open(ctx, key)
	return reader, err
}

func readSharedItem(ctx context.Context, m data.Models, owner, course, id string) (domain.Deliverable, error) {
	if id != "classroom" && id != "course-document" {
		item, err := m.Deliverables.Get(ctx, course, id)
		return item, missing(err)
	}
	stored, err := m.Deliverables.List(ctx, course)
	if err != nil {
		return domain.Deliverable{}, err
	}
	items, err := classroomFiles(ctx, m, owner, course, stored)
	if err != nil {
		return domain.Deliverable{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return domain.Deliverable{}, missing(pgx.ErrNoRows)
}

type ShareAccess struct {
	Visibility string   `json:"visibility"`
	ClassIDs   []string `json:"classIds"`
}

// A nil input reads settings without creating or publishing a link.
func (s *Service) Sharing(ctx context.Context, auth identity.Authorize, course, id string, input *ShareAccess) (result data.DeliverableShare, err error) {
	if input != nil && input.Visibility != "private" && input.Visibility != "public" && input.Visibility != "class" {
		return result, fault.Invalid("请选择仅自己可见、班级内可见或获得链接的任何人可见")
	}
	err = s.within(ctx, auth, course, func(m data.Models, user domain.User) error {
		if _, e := readSharedItem(ctx, m, user.ID, course, id); e != nil {
			return e
		}
		if input != nil {
			classes := []string{}
			if input.Visibility == "class" {
				if len(input.ClassIDs) == 0 {
					return fault.Invalid("请选择自己所在的班级")
				}
				classes = slices.Clone(input.ClassIDs)
				slices.Sort(classes)
				classes = slices.Compact(classes)
				for _, class := range classes {
					if _, _, e := m.Classes.Lock(ctx, class); errors.Is(e, pgx.ErrNoRows) {
						return fault.Invalid("所选班级不存在")
					} else if e != nil {
						return e
					}
					member, e := m.Classes.IsMember(ctx, class, user.ID)
					if e != nil {
						return e
					}
					if !member {
						return fault.Invalid("只能分享给自己所在的班级")
					}
				}
			}
			result, err = m.Deliverables.SetShare(ctx, course, id, rand.Text(), input.Visibility, classes)
			return err
		}
		result, err = m.Deliverables.Share(ctx, course, id)
		if errors.Is(err, pgx.ErrNoRows) {
			result = data.DeliverableShare{Visibility: "private"}
			return nil
		}
		return err
	})
	return
}

// Resolve against the current source on every request. Never publish session state.
func (s *Service) Shared(ctx context.Context, auth identity.Authorize, token string) (item domain.Deliverable, err error) {
	err = s.shared(ctx, auth, token, func(_ data.Models, _ data.DeliverableShare, current domain.Deliverable) error {
		item = current
		for i := range item.Blocks {
			item.Blocks[i].Source = nil
		}
		return nil
	})
	return
}

func (s *Service) shared(ctx context.Context, auth identity.Authorize, token string, action func(data.Models, data.DeliverableShare, domain.Deliverable) error) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		// Identity locks must precede the course lock, as they do for settings writes.
		// Missing/expired sessions remain valid callers of explicitly public links.
		user, authErr := auth(ctx, m)
		if authErr != nil && !errors.Is(authErr, data.ErrInvalidSession) {
			return authErr
		}
		share, err := m.Deliverables.ShareByToken(ctx, token)
		if err != nil {
			return missing(err)
		}
		// Use the same course lock as settings changes so revocation is rechecked.
		if err = m.Deliverables.LockCourse(ctx, share.OwnerID, share.CourseID); err != nil {
			return err
		}
		share, err = m.Deliverables.ShareByToken(ctx, token)
		if err != nil {
			return missing(err)
		}
		if share.Visibility != "public" {
			if authErr != nil {
				return missing(pgx.ErrNoRows)
			}
			if user.ID != share.OwnerID {
				if share.Visibility != "class" || len(share.ClassIDs) == 0 {
					return missing(pgx.ErrNoRows)
				}
				allowed := false
				for _, class := range share.ClassIDs {
					if _, _, e := m.Classes.Lock(ctx, class); errors.Is(e, pgx.ErrNoRows) {
						continue
					} else if e != nil {
						return missing(e)
					}
					both := true
					for _, id := range []string{user.ID, share.OwnerID} {
						member, e := m.Classes.IsMember(ctx, class, id)
						if e != nil {
							return e
						}
						if !member {
							both = false
							break
						}
					}
					if both {
						allowed = true
						break
					}
				}
				if !allowed {
					return missing(pgx.ErrNoRows)
				}
			}
		}
		item, err := readSharedItem(ctx, m, share.OwnerID, share.CourseID, share.DeliverableID)
		if err != nil {
			return err
		}
		return action(m, share, item)
	})
}
