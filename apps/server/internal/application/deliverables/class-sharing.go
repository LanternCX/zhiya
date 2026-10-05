package deliverables

import (
	"context"
	"slices"
	"time"

	fault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/jackc/pgx/v5"
)

type ClassShare struct {
	Token       string    `json:"token"`
	Title       string    `json:"title"`
	Kind        string    `json:"kind"`
	TeacherName string    `json:"teacherName"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Only explicitly class-scoped publications by current teachers appear here.
func (s *Service) ClassShares(ctx context.Context, auth identity.Authorize, class string) (items []ClassShare, err error) {
	items = []ClassShare{}
	err = s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, e := auth(ctx, m)
		if e != nil {
			return e
		}
		if _, _, e = m.Classes.Lock(ctx, class); e != nil {
			return missing(e)
		}
		member, e := m.Classes.IsMember(ctx, class, user.ID)
		if e != nil {
			return e
		}
		if !member {
			return missing(pgx.ErrNoRows)
		}
		publications, e := m.Deliverables.ClassPublications(ctx, class)
		if e != nil {
			return e
		}
		for _, publication := range publications {
			share := publication.Share
			item, e := readSharedItem(ctx, m, share.OwnerID, share.CourseID, share.DeliverableID)
			if code, _, _ := fault.ErrorDetails(e); code == fault.ErrorNotFound {
				continue
			}
			if e != nil {
				return e
			}
			items = append(items, ClassShare{Token: share.Token, Title: item.Title, Kind: item.Kind, TeacherName: publication.TeacherName, UpdatedAt: item.UpdatedAt})
		}
		slices.SortStableFunc(items, func(a, b ClassShare) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
		return nil
	})
	return
}
