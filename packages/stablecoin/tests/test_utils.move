#[test_only]
module stablecoin::test_utils {
    use sui::event;
    use sui::test_utils::assert_eq;

    public(package) fun last_event_by_type<T: copy + drop>(): T {
        let events_by_type = event::events_by_type();
        assert_eq(events_by_type.is_empty(), false);
        *events_by_type.borrow(events_by_type.length() - 1)
    }
}
