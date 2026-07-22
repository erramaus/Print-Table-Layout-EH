import type { Painting } from '../types';

interface CurrentOrderProps {
  order: Painting[];
  onDelete: (id: string) => void;
}

function CurrentOrder({ order, onDelete }: CurrentOrderProps) {
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
            <div key={item.id} className="order-item order-item-compact">
              <div className="order-item-main">
                <span className="color-dot" style={{ backgroundColor: item.color }} />
                <div>
                  <p className="item-title">{item.referenceNumber}</p>
                  <p className="item-meta">{item.name ?? 'No Name'}</p>
                  <p className="item-meta">
                    {item.width} × {item.height}
                    {' · '}
                    {item.orientation === 'VERTICAL' ? 'VERT' : 'HORI'}
                  </p>
                </div>
              </div>
              <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default CurrentOrder;
