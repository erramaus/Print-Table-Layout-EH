import type { Painting } from '../types';
import { getMutedHexColor } from '../utils/colorTreatment';

interface CurrentOrderProps {
  order: Painting[];
  onDelete: (id: string) => void;
  onEditPainting: (id: string) => void;
}

function CurrentOrder({ order, onDelete, onEditPainting }: CurrentOrderProps) {
  return (
    <div className="panel-section order-list">
      <div className="section-header">
        <h2>Current Order</h2>
        <span>{order.length} items</span>
      </div>
      <div className="order-items">
        {order.length === 0 ? (
          <p className="empty-state">No paintings added yet.</p>
        ) : (
          order.map((item) => (
            (() => {
              const mutedColor = getMutedHexColor(item.color, 0.5);

              return (
            <div
              key={item.id}
              className="order-item order-item-compact"
              role="button"
              tabIndex={0}
              onClick={() => onEditPainting(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onEditPainting(item.id);
                }
              }}
            >
              <div className="order-item-main">
                <span className="color-dot" style={{ backgroundColor: mutedColor }} />
                <div>
                  <p className="item-title">{item.referenceNumber}</p>
                  <p className="item-meta">{item.name ?? 'No Name'}</p>
                  <p className="item-meta">
                    {item.width} × {item.height}
                    {' · '}
                    {item.orientation}
                  </p>
                </div>
              </div>
              <button
                className="delete-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
              >
                Delete
              </button>
            </div>
              );
            })()
          ))
        )}
      </div>
    </div>
  );
}

export default CurrentOrder;
