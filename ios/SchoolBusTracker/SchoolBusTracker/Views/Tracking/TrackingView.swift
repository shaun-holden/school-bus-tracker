import SwiftUI
import MapKit

struct TrackingView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 39.8283, longitude: -98.5795),
        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
    )

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if viewModel.childrenBuses.isEmpty {
                    emptyState
                } else {
                    Map(coordinateRegion: $region, annotationItems: busAnnotations) { item in
                        MapAnnotation(coordinate: item.coordinate) {
                            VStack(spacing: 2) {
                                Image(systemName: "bus.fill")
                                    .font(.title2)
                                    .foregroundColor(item.bus?.status == "on_route" ? .green : .gray)
                                    .padding(6)
                                    .background(.white)
                                    .clipShape(Circle())
                                    .shadow(radius: 3)
                                Text("Bus #\(item.bus?.busNumber ?? "?")")
                                    .font(.caption2)
                                    .fontWeight(.bold)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(.white.opacity(0.9))
                                    .cornerRadius(4)
                            }
                        }
                    }
                    .ignoresSafeArea(edges: .bottom)

                    // Bottom student list
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(viewModel.childrenBuses) { child in
                                TrackingStudentChip(child: child)
                            }
                        }
                        .padding()
                    }
                    .background(.ultraThinMaterial)
                }
            }
            .navigationTitle("Live Tracking")
            .onAppear { centerMapOnBuses() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "map")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No Active Buses")
                .font(.headline)
            Text("Bus locations will appear here when drivers are on route.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    private var busAnnotations: [BusAnnotation] {
        viewModel.childrenBuses.compactMap { child in
            guard let coord = child.bus?.coordinate else { return nil }
            return BusAnnotation(id: child.id, coordinate: coord, bus: child.bus)
        }
    }

    private func centerMapOnBuses() {
        let coords = busAnnotations.map(\.coordinate)
        guard !coords.isEmpty else { return }

        let lats = coords.map(\.latitude)
        let lons = coords.map(\.longitude)
        let center = CLLocationCoordinate2D(
            latitude: (lats.min()! + lats.max()!) / 2,
            longitude: (lons.min()! + lons.max()!) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max((lats.max()! - lats.min()!) * 1.5, 0.01),
            longitudeDelta: max((lons.max()! - lons.min()!) * 1.5, 0.01)
        )
        region = MKCoordinateRegion(center: center, span: span)
    }
}

struct BusAnnotation: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let bus: BusLocation?
}

struct TrackingStudentChip: View {
    let child: ChildBusData

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(child.student.fullName)
                .font(.subheadline)
                .fontWeight(.semibold)
            if let bus = child.bus {
                HStack(spacing: 4) {
                    Image(systemName: "bus.fill")
                        .font(.caption2)
                    Text("Bus #\(bus.busNumber)")
                        .font(.caption)
                }
                .foregroundColor(bus.status == "on_route" ? .green : .secondary)
            }
            if let route = child.route {
                Text(route.name)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(10)
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
    }
}
