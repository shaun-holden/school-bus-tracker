import Foundation
import CoreLocation

struct ChildBusData: Codable, Identifiable {
    var id: String { student.id }

    let student: StudentBasic
    let bus: BusLocation?
    let route: RouteInfo?
    let stop: StopInfo?
}

struct StudentBasic: Codable {
    let id: String
    let firstName: String
    let lastName: String
    let grade: String?

    var fullName: String {
        "\(firstName) \(lastName)"
    }
}

struct BusLocation: Codable, Identifiable {
    let id: String
    let busNumber: String
    let status: String?
    let latitude: String?
    let longitude: String?
    let speed: String?
    let lastUpdated: String?

    var coordinate: CLLocationCoordinate2D? {
        guard let latStr = latitude, let lonStr = longitude,
              let lat = Double(latStr), let lon = Double(lonStr) else {
            return nil
        }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

struct StopProgress: Codable {
    let hasRoute: Bool
    let hasStop: Bool?
    let studentStopId: String?
    let studentStopAddress: String?
    let studentStopSequence: Int?
    let totalStops: Int?
    let completedStopsCount: Int?
    let stopsAway: Int?
    let hasArrived: Bool?
    let lastCompletedStopId: String?
    let message: String?
}

struct CheckInStatus: Codable, Identifiable {
    let id: String
    let studentId: String
    let status: String
    let boardedAt: String?
    let droppedOffAt: String?
}
